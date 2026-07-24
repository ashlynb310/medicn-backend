import { apiFetch } from "./client";
import type {
  AdminListing,
  ListingStatus,
  ModerateListingInput,
  PaginationMeta,
} from "./types";

// Admin moderation endpoints (see medicn/apps/api/src/admin). All require a
// bearer token AND the MediCN `admin` role; the backend returns FORBIDDEN
// otherwise. When accessToken is omitted, apiFetch uses the ambient token.

export interface AdminListingsParams {
  status?: ListingStatus;
  page?: number;
  limit?: number;
}

/** GET /api/v1/admin/listings — defaults to status=pending on the backend. */
export async function listAdminListings(
  params: AdminListingsParams = {},
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data, meta } = await apiFetch<AdminListing[], PaginationMeta>(
    "/admin/listings",
    {
      query: {
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
      accessToken,
      signal,
    }
  );
  return { listings: data, meta };
}

/**
 * PATCH /api/v1/admin/listings/:id/status — approve or reject a PENDING listing.
 * Returns the updated listing. Surfaces UNAUTHORIZED, FORBIDDEN, NOT_FOUND,
 * VALIDATION_ERROR, and LISTING_STATUS_NOT_ALLOWED via ApiError.
 */
export async function moderateListing(
  id: string,
  input: ModerateListingInput,
  accessToken?: string
) {
  const { data } = await apiFetch<AdminListing>(
    `/admin/listings/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      body: {
        status: input.status,
        ...(input.note ? { note: input.note } : {}),
      },
      accessToken,
    }
  );
  return data;
}
