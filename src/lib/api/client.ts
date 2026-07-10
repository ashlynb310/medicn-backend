import type { ApiErrorPayload, ApiResponse } from "./types";

const DEFAULT_API_URL = "http://localhost:4100/api/v1";

export function getApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_URL).replace(/\/+$/, "");
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
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
  const { method = "GET", query, body, accessToken, signal } = options;

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

  let envelope: ApiResponse<TData, TMeta>;
  try {
    envelope = (await response.json()) as ApiResponse<TData, TMeta>;
  } catch {
    throw new ApiError(
      {
        code: "INVALID_RESPONSE",
        message: "The MediCN service returned an unexpected response.",
      },
      response.status
    );
  }

  if (envelope?.error) {
    throw new ApiError(envelope.error, response.status);
  }

  if (!response.ok || envelope?.data === undefined) {
    throw new ApiError(
      {
        code: "INVALID_RESPONSE",
        message: "The MediCN service returned an unexpected response.",
      },
      response.status
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
