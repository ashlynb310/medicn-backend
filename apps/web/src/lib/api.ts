import type { ApiResponse } from "@medicn/types";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100/api/v1";

interface CallApiOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly response: ApiResponse<unknown>
  ) {
    super(response.error?.message ?? "Backend request failed");
  }

  get code() {
    return this.response.error?.code ?? "INTERNAL_SERVER_ERROR";
  }
}

export async function callApi<TData = unknown>(
  path: string,
  token: string | null,
  options: CallApiOptions = {}
): Promise<ApiResponse<TData>> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const body = (await response.json()) as ApiResponse<TData>;

  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }

  return body;
}
