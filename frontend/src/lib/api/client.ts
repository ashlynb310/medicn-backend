import type { ApiErrorCode, ApiErrorPayload, ApiResponse } from "./types";

const DEFAULT_API_URL = "http://localhost:4100/api/v1";

export function getApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_URL).replace(/\/+$/, "");
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /**
   * Parsed `Retry-After` for a 429/503 (seconds). null when the header is
   * absent or unparseable. The backend sets it for rate-limited responses.
   */
  readonly retryAfterSeconds: number | null;

  constructor(
    payload: ApiErrorPayload,
    status: number,
    retryAfterSeconds: number | null = null
  ) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type QueryValue = string | number | boolean | undefined | null;

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * Supabase access token. Authorization is attached only when a token exists.
   * - omitted: fall back to the ambient token (set by the auth provider when a
   *   user is logged in), so authenticated calls don't need to thread the token.
   * - explicit `null`: force no Authorization header (public request).
   * - explicit string: use that token.
   */
  accessToken?: string | null;
  signal?: AbortSignal;
  /**
   * Sets the `Idempotency-Key` header. Required by the backend for retry-safe
   * mutations (booking cancel, admin requeue/reconciliation). Callers generate
   * a stable key per logical attempt so retries don't create duplicate work.
   */
  idempotencyKey?: string;
}

/** Parses a `Retry-After` header (delta-seconds form) into seconds. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
  }
  return null;
}

// Ambient token getter registered by the auth provider. Lets apiFetch attach
// `Authorization: Bearer <token>` automatically whenever a user is logged in.
let ambientAccessToken: () => string | null = () => null;

export function setAmbientAccessTokenGetter(getter: () => string | null) {
  ambientAccessToken = getter;
}

export interface ApiResult<TData, TMeta> {
  data: TData;
  meta: TMeta;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const url = new URL(
    `${getApiBaseUrl()}/${path.replace(/^\/+/, "")}`
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export async function apiFetch<TData, TMeta = Record<string, never>>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<ApiResult<TData, TMeta>> {
  const { method = "GET", query, body, accessToken, signal, idempotencyKey } =
    options;

  // Omitted token -> ambient (logged-in) token; explicit null -> no auth header.
  const resolvedToken =
    accessToken === undefined ? ambientAccessToken() : accessToken;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (resolvedToken) {
    headers["Authorization"] = `Bearer ${resolvedToken}`;
  }
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: "no-store",
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new ApiError(
      {
        code: "NETWORK_ERROR",
        message:
          "Could not reach the MediCN service. Check your connection and try again.",
      },
      0
    );
  }

  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));

  let envelope: ApiResponse<TData, TMeta>;
  try {
    envelope = (await response.json()) as ApiResponse<TData, TMeta>;
  } catch {
    throw new ApiError(
      {
        code: "INVALID_RESPONSE",
        message: "The MediCN service returned an unexpected response.",
      },
      response.status,
      retryAfterSeconds
    );
  }

  if (envelope?.error) {
    throw new ApiError(envelope.error, response.status, retryAfterSeconds);
  }

  if (!response.ok || envelope?.data === undefined) {
    throw new ApiError(
      {
        code: "INVALID_RESPONSE",
        message: "The MediCN service returned an unexpected response.",
      },
      response.status,
      retryAfterSeconds
    );
  }

  return { data: envelope.data as TData, meta: envelope.meta };
}

export function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
