import { apiFetch } from "./client";
import type {
  CreatedInquiry,
  InquiryArchiveResult,
  InquiryCloseResult,
  InquiryListMeta,
  InquiryReadResult,
  InquiryStatus,
  InquirySummary,
  InquiryThread,
  SentInquiryMessage,
} from "./types";

// Messaging endpoints (see medicn/apps/api/src/messaging). REST is the ONLY
// write path — Socket.IO is notification-only. All routes require a Supabase
// bearer token; when accessToken is omitted, apiFetch uses the ambient token.
// Unrelated/missing inquiries return opaque NOT_FOUND.

/**
 * POST /api/v1/listings/:listingId/inquiries — verified Renter contacts the
 * captured Host of an approved, non-archived listing. Body is exactly
 * `{ message }`; hostId is copied from the listing by the backend and is never
 * request input. Returns the new inquiry plus its first message.
 *
 * Surfaces INQUIRY_ALREADY_OPEN (one open inquiry per renter/listing),
 * INQUIRY_NOT_AVAILABLE, CONTACT_INFORMATION_NOT_ALLOWED, EMAIL_NOT_VERIFIED,
 * FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, and rate-limit errors via ApiError.
 */
export async function createInquiry(
  listingId: string,
  message: string,
  accessToken?: string
) {
  const { data } = await apiFetch<CreatedInquiry>(
    `/listings/${encodeURIComponent(listingId)}/inquiries`,
    { method: "POST", body: { message }, accessToken }
  );
  return data;
}

/**
 * GET /api/v1/inquiries — actor-scoped inbox ordered by lastMessageAt DESC.
 * Defaults to unarchived. limit ≤100. Meta is { page, limit, total }.
 */
export async function listInquiries(
  params: {
    status?: InquiryStatus;
    archived?: boolean;
    page?: number;
    limit?: number;
  } = {},
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data, meta } = await apiFetch<InquirySummary[], InquiryListMeta>(
    "/inquiries",
    {
      query: {
        status: params.status,
        archived: params.archived,
        page: params.page,
        limit: params.limit,
      },
      accessToken,
      signal,
    }
  );
  return { inquiries: data, meta };
}

/**
 * GET /api/v1/inquiries/:id?afterSequence=&limit= — thread detail and REST
 * catch-up. Messages come back in ascending `sequence` order; `nextCursor` is
 * the last returned sequence and `hasMore` signals another page. This is the
 * authoritative source after any realtime notification, gap, or reconnect.
 */
export async function getInquiryThread(
  inquiryId: string,
  params: { afterSequence?: number; limit?: number } = {},
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<InquiryThread>(
    `/inquiries/${encodeURIComponent(inquiryId)}`,
    {
      query: { afterSequence: params.afterSequence, limit: params.limit },
      accessToken,
      signal,
    }
  );
  return data;
}

/**
 * POST /api/v1/inquiries/:id/messages — the only message write path. Body is
 * exactly `{ message }`; the backend allocates the sequence. Surfaces
 * INQUIRY_CLOSED, CONTACT_INFORMATION_NOT_ALLOWED, VALIDATION_ERROR,
 * NOT_FOUND, and message_send rate-limit errors.
 */
export async function sendInquiryMessage(
  inquiryId: string,
  message: string,
  accessToken?: string
) {
  const { data } = await apiFetch<SentInquiryMessage>(
    `/inquiries/${encodeURIComponent(inquiryId)}/messages`,
    { method: "POST", body: { message }, accessToken }
  );
  return data;
}

/**
 * POST /api/v1/inquiries/:id/read — advance this user's read cursor. The
 * backend clamps to the committed lastSequence and moves it with GREATEST, so
 * the cursor is monotonic and idempotent.
 */
export async function markInquiryRead(
  inquiryId: string,
  sequence: number,
  accessToken?: string
) {
  const { data } = await apiFetch<InquiryReadResult>(
    `/inquiries/${encodeURIComponent(inquiryId)}/read`,
    { method: "POST", body: { sequence }, accessToken }
  );
  return data;
}

/** POST /api/v1/inquiries/:id/close — thread-wide, idempotent, PERMANENT. */
export async function closeInquiry(inquiryId: string, accessToken?: string) {
  const { data } = await apiFetch<InquiryCloseResult>(
    `/inquiries/${encodeURIComponent(inquiryId)}/close`,
    { method: "POST", accessToken }
  );
  return data;
}

/** POST /api/v1/inquiries/:id/archive — changes only the caller's own state. */
export async function setInquiryArchived(
  inquiryId: string,
  archived: boolean,
  accessToken?: string
) {
  const { data } = await apiFetch<InquiryArchiveResult>(
    `/inquiries/${encodeURIComponent(inquiryId)}/archive`,
    { method: "POST", body: { archived }, accessToken }
  );
  return data;
}
