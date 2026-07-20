// Shared API types matching the medicn backend response envelope and the
// listings DTOs returned by apps/api (see ListingsService.toListingSummaryDto
// and toListingDetailDto).

// Backend-issued error codes (mirrors packages/types/src/index.ts ApiErrorCode).
// Kept in sync manually; the frontend never invents codes the backend can send.
export type BackendApiErrorCode =
  | "ACCOUNT_DISABLED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_SUPABASE_TOKEN"
  | "USER_NOT_SYNCED"
  | "EMAIL_NOT_VERIFIED"
  | "INQUIRY_NOT_AVAILABLE"
  | "INQUIRY_ALREADY_OPEN"
  | "INQUIRY_CLOSED"
  | "CONTACT_INFORMATION_NOT_ALLOWED"
  | "BOOKING_STATUS_NOT_ALLOWED"
  | "CONNECT_NOT_CONFIGURED"
  | "CONNECT_ONBOARDING_REQUIRED"
  | "HOST_PAYOUT_ACCOUNT_NOT_READY"
  | "IDENTITY_VERIFICATION_EXPIRED"
  | "IDENTITY_VERIFICATION_PENDING"
  | "IDENTITY_VERIFICATION_REJECTED"
  | "IDENTITY_VERIFICATION_REQUIRED"
  | "LISTING_LOCATION_CHANGE_BLOCKED"
  | "LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS"
  | "LISTING_LOCATION_INVALID"
  | "LISTING_LOCATION_NOT_READY"
  | "LISTING_STATUS_NOT_ALLOWED"
  | "MEDIA_INPUT_TOO_LARGE"
  | "MEDIA_NOT_CONFIGURED"
  | "MEDIA_PROCESSING_REQUIRED"
  | "MEDIA_STORAGE_UNAVAILABLE"
  | "MEDIA_UPLOAD_EXPIRED"
  | "MEDIA_UPLOAD_LIMIT_REACHED"
  | "MEDIA_UPLOAD_OBJECT_MISSING"
  | "TRANSFER_ALREADY_RELEASED"
  | "TRANSFER_FAILED"
  | "TRANSFER_NOT_ELIGIBLE"
  | "VERIFF_NOT_CONFIGURED"
  | "VERIFF_PROVIDER_UNAVAILABLE"
  | "VERIFICATION_REQUIRED"
  | "LISTING_NOT_AVAILABLE"
  | "BOOKING_NOT_AVAILABLE"
  | "AVAILABILITY_RANGE_INVALID"
  | "AVAILABILITY_CONFLICTS_WITH_RESERVATION"
  | "AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED"
  | "CALENDAR_RANGE_TOO_LARGE"
  | "LISTING_TIMEZONE_INVALID"
  | "BOOKING_CANCELLATION_NOT_ALLOWED"
  | "PAID_CANCELLATION_POLICY_UNAVAILABLE"
  | "CANCELLATION_ALREADY_IN_PROGRESS"
  | "PAYMENT_STATE_CHANGED"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "PAYMENT_FAILED"
  | "OPERATIONAL_DATE_RANGE_INVALID"
  | "OPERATIONAL_COMMAND_INVALID"
  | "OPERATIONAL_IDEMPOTENCY_CONFLICT"
  | "JOB_EXECUTION_NOT_REQUEUEABLE"
  | "RECONCILIATION_SCOPE_INVALID"
  | "RATE_LIMITED"
  | "RATE_LIMIT_EXCEEDED"
  | "RATE_LIMIT_UNAVAILABLE"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_SERVER_ERROR";

// Codes the frontend client itself raises for transport-level failures that
// never reach the backend envelope.
export type ClientApiErrorCode =
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "UPLOAD_NETWORK_ERROR"
  | "UPLOAD_FAILED";

// `(string & {})` keeps autocomplete for known codes while still accepting any
// future backend code without a frontend type break.
export type ApiErrorCode =
  | BackendApiErrorCode
  | ClientApiErrorCode
  | (string & {});

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export type ApiResponse<TData, TMeta = Record<string, never>> =
  | { data: TData; meta: TMeta; error: null }
  | { data: null; meta: TMeta; error: ApiErrorPayload };

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type PriceUnit = "day" | "night" | "month";
export type ListingType = "private_room" | "entire_home" | "shared_room";
export type StayDuration = "short_term" | "medium_term" | "long_term";
export type ProximityTag = "near_hospitals" | "public_transit";
export type SpecialFeature = "fully_furnished" | "pet_friendly" | "access_24_7";
export type ListingSort = "newest" | "price_asc" | "price_desc";
export type ListingStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "hidden"
  | "archived";

export interface ListingHostSummary {
  id: string;
  firstName: string | null;
  displayName: string | null;
}

export interface ListingHostDetail extends ListingHostSummary {
  lastName: string | null;
  bio: string | null;
  profilePhotoUrl: string | null;
}

// Public, deliberately coarse location. Backend returns this for every viewer.
// Never a street address, unit, exact pin, or exact Place ID.
export interface PublicListingLocation {
  city: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  precision: "approximate";
}

// Exact location. Backend returns this only in an owner/admin listing
// projection (canViewExactLocation); it is null for ordinary public viewers.
export interface ExactListingLocation {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ListingLocationStatus {
  geocode: string;
  enrichment: string;
  // Only present in the owner/admin projection.
  addressVersion?: number | null;
  failureCategory?: string | null;
}

export interface ListingNearbyPlace {
  category: string;
  name: string;
  mapsUrl: string | null;
  approximateDistanceMeters: number | null;
  routeDistanceMeters: number | null;
  routeDurationSeconds: number | null;
  travelMode: string | null;
  dataUpdatedAt: string;
}

export interface ListingSummary {
  id: string;
  title: string;
  city: string;
  priceCents: number;
  currency: string;
  priceUnit: PriceUnit;
  status: string;
  publicLocation: PublicListingLocation;
  exactLocation: ExactListingLocation | null;
  coverPhotoUrl: string | null;
  stayDurations: StayDuration[];
  host: ListingHostSummary;
}

export interface ListingPhoto {
  id: string;
  fileUrl: string;
  displayOrder: number;
  // Backend marks pre-pipeline photos "legacy"; processed derivatives "processed".
  source?: "processed" | "legacy";
}

// Host-writable window status. There is no writable "reserved"/"booked" status.
export type ListingAvailabilityStatus = "available" | "blocked";

export interface ListingAvailabilityWindow {
  id: string;
  startDate: string;
  endDate: string;
  status: ListingAvailabilityStatus;
}

export interface CivilDateRange {
  startDate: string;
  endDate: string;
}

// GET /listings/:id/availability/calendar (owner/admin). Reservation ranges are
// opaque and read-only; they never reveal booking id/status or renter identity.
export interface ReservedCalendarRange extends CivilDateRange {
  status: "reserved";
}

export interface HostListingCalendar {
  listingId: string;
  timeZone: string;
  range: CivilDateRange;
  windows: ListingAvailabilityWindow[];
  reservations: ReservedCalendarRange[];
}

// GET /listings/:id/calendar (public, approved only). Only merged unavailable
// ranges; never distinguishes Host-blocked from reserved.
export interface PublicListingCalendar {
  timeZone: string;
  range: CivilDateRange;
  unavailable: CivilDateRange[];
}

// Availability list meta is page/limit/total only (no totalPages).
export interface AvailabilityListMeta {
  page: number;
  limit: number;
  total: number;
}

export type ListingPlaceType = "neighborhood_perk" | "local_recommendation";

export interface ListingPlace {
  id: string;
  type: ListingPlaceType;
  label: string;
  googlePlaceId: string | null;
  mapsUrl: string | null;
  displayOrder: number;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  listingType: ListingType;
  category: string | null;
  proximityTags: string[];
  specialFeatures: string[];
  createdAt: string;
  updatedAt: string;
  timeZone: string;
  // Only in the owner/admin projection (canViewExactLocation).
  checkoutTime?: string;
  locationStatus: ListingLocationStatus;
  nearbyPlaces: ListingNearbyPlace[];
  photos: ListingPhoto[];
  // Publishable availability windows are returned only in the owner/admin
  // projection. Public visitors read unavailable dates from the calendar
  // endpoint instead (a later phase), so this is optional.
  availability?: ListingAvailabilityWindow[];
  places: ListingPlace[];
  host: ListingHostDetail;
}

export interface SearchListingsParams {
  location?: string;
  city?: string;
  nearbyHospital?: string;
  listingType?: ListingType;
  category?: string;
  stayDuration?: StayDuration;
  startDate?: string;
  endDate?: string;
  minPrice?: number;
  maxPrice?: number;
  priceUnit?: PriceUnit;
  sort?: ListingSort;
  page?: number;
  limit?: number;
  bounds?: string;
}

// --- Bookings (see medicn/apps/api/src/bookings) ---

// Backend BookingStatus enum (schema.prisma).
export type BookingStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "payment_pending"
  | "paid"
  | "completed";

// Party summary the backend embeds in a booking (host / renter).
export interface BookingPartyRef {
  id: string;
  email: string;
  firstName: string | null;
  displayName: string | null;
}

export interface BookingListingRef {
  id: string;
  title: string;
  priceUnit: PriceUnit;
  host: BookingPartyRef;
}

// Source that drove an automated lifecycle transition (expiry/completion).
export type BookingLifecycleSource = "operations_scheduler" | "legacy_backfill";

export type CancellationActorType = "renter" | "host" | "admin" | "system";
export type CancellationOperationStatus =
  | "requested"
  | "checkout_expiry_pending"
  | "refund_pending"
  | "refund_confirmed"
  | "transfer_reversal_pending"
  | "completed"
  | "failed_retryable"
  | "failed_permanent";
export type CancellationFinancialDisposition =
  | "no_payment_collected"
  | "checkout_expiry_pending"
  | "full_refund_pending"
  | "full_refund_confirmed"
  | "transfer_reversal_pending"
  | "financially_complete";

export interface BookingCancellationSummary {
  id: string;
  actorType: CancellationActorType;
  reason: string;
  status: CancellationOperationStatus;
  financialDisposition: CancellationFinancialDisposition;
  requestedAt: string;
  effectiveAt: string | null;
}

// Exact check-in location. The backend includes this in a booking DETAIL
// response only when the viewer is authorized (host/admin, or the renter of a
// paid/completed booking with a settled, non-revoked payment). Never inferred
// from frontend state.
export interface CheckInLocation {
  address: string;
  latitude: number | null;
  longitude: number | null;
  sourceListingLocationVersion: number | null;
  capturedAt: string | null;
}

// Mirrors BookingsService.toBookingDto. `checkInLocation` and `cancellation`
// are present only on the detail response (GET /bookings/:id).
export interface Booking {
  id: string;
  listingId: string;
  renterId: string;
  hostId: string;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  timeZone: string;
  checkoutTime: string;
  requestExpiresAt: string;
  expiredAt: string | null;
  expirySource: BookingLifecycleSource | null;
  completedAt: string | null;
  completionSource: BookingLifecycleSource | null;
  selectedOption: string;
  additionalRequests: string | null;
  totalAmountCents: number;
  currency: string;
  cancellationReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkInLocation?: CheckInLocation | null;
  cancellation?: BookingCancellationSummary | null;
  listing: BookingListingRef;
  renter: BookingPartyRef;
}

// Matches CreateBookingDto exactly.
export interface CreateBookingInput {
  listingId: string;
  startDate: string;
  endDate: string;
  selectedOption: string;
  additionalRequests?: string;
}

export interface BookingListMeta {
  total: number;
}

// --- Cancellation (POST /bookings/:id/cancel) ---

// Full set the backend accepts (CancelBookingDto). The frontend only OFFERS the
// role-appropriate subsets below; it never sends actor IDs, amounts, or
// financial instructions — only `reason`.
export type CancellationRequestReason =
  | "plans_changed"
  | "booking_no_longer_needed"
  | "property_unavailable"
  | "cannot_accommodate"
  | "safety_issue"
  | "support_resolution"
  | "fraud_risk"
  | "provider_failure"
  | "other";

export const RENTER_CANCELLATION_REASONS: {
  value: CancellationRequestReason;
  label: string;
}[] = [
  { value: "plans_changed", label: "Plans changed" },
  { value: "booking_no_longer_needed", label: "No longer needed" },
  { value: "other", label: "Other" },
];

export const HOST_CANCELLATION_REASONS: {
  value: CancellationRequestReason;
  label: string;
}[] = [
  { value: "property_unavailable", label: "Property unavailable" },
  { value: "cannot_accommodate", label: "Cannot accommodate" },
  { value: "safety_issue", label: "Safety issue" },
  { value: "other", label: "Other" },
];

// Response of POST /bookings/:id/cancel (BookingCancellationsService.toResult).
export interface BookingCancellationResult {
  bookingId: string;
  bookingStatus: BookingStatus;
  cancellation: BookingCancellationSummary;
}

// --- Payment summary (GET /bookings/:id/payment-summary) ---

export type SafePaymentLifecycleStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "partially_refunded"
  | "refunded"
  | "disputed";

export interface PaymentAttempt {
  id: string;
  attemptNumber: number;
  status: SafePaymentLifecycleStatus;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  active: boolean;
  expiresAt: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// A Stripe Transfer to the Host's connected Stripe balance. This is NOT a bank
// payout and must never be labeled as one (representsBankPayout is always false).
export interface HostTransferSummary {
  status: string;
  reversalStatus: string;
  grossAmountCents: number;
  platformFeeCents: number;
  hostNetAmountCents: number;
  reversedAmountCents: number;
  reversalTargetAmountCents: number;
  currency: string;
  eligibleAt: string;
  movement: "stripe_transfer_to_connected_balance";
  representsBankPayout: false;
  transferredAt: string | null;
}

// Mirrors BookingPaymentSummaryDto. Payment state is authoritative here and in
// GET /bookings/:id — never inferred from booking status, URL, or session_id.
export interface BookingPaymentSummary {
  bookingId: string;
  bookingStatus: BookingStatus;
  totalAmountCents: number;
  currency: string;
  payments: PaymentAttempt[];
  transfer: HostTransferSummary | null;
}

// --- Stripe Checkout (POST /payments/checkout-session) ---

// Mirrors CheckoutSessionDto. No amounts, secrets, or booking data — the browser
// only redirects to checkoutUrl; the backend calculates all amounts.
export interface CheckoutSession {
  checkoutSessionId: string;
  checkoutUrl: string;
  expiresAt: string;
}

// --- Host listing management (see medicn/apps/api/src/listings + uploads) ---

// Matches CreateListingDto exactly. Fields the DTO does not declare must NOT be
// sent — the backend ValidationPipe uses forbidNonWhitelisted. `timeZone` is
// required. `latitude`/`longitude` are REJECTED by the backend (@IsEmpty), so
// the browser never sends them: the Host selects an address (with optional
// placeId) and the backend resolves authoritative coordinates. Post-create
// availability is managed through the dedicated availability endpoints, not
// this payload.
export interface CreateListingInput {
  title: string;
  description: string;
  city: string;
  timeZone: string;
  checkoutTime?: string;
  address?: string;
  placeId?: string;
  priceCents: number;
  priceUnit: PriceUnit;
  listingType: ListingType;
  category?: string;
  stayDurations?: StayDuration[];
  proximityTags?: ProximityTag[];
  specialFeatures?: SpecialFeature[];
  neighborhoodPerks?: string[];
  localRecommendations?: string[];
}

// Matches UpdateListingDto. All fields optional; the legacy bulk `availability`
// replacement is intentionally omitted — it is rejected with
// AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED. Manage calendar via the availability
// endpoints instead. latitude/longitude are rejected, as with create.
export interface UpdateListingInput {
  title?: string;
  description?: string;
  city?: string;
  timeZone?: string;
  checkoutTime?: string;
  address?: string;
  placeId?: string;
  priceCents?: number;
  priceUnit?: PriceUnit;
  listingType?: ListingType;
  category?: string;
  stayDurations?: StayDuration[];
  proximityTags?: ProximityTag[];
  specialFeatures?: SpecialFeature[];
  neighborhoodPerks?: string[];
  localRecommendations?: string[];
}

// POST /listings returns only { id, status } (status starts as "pending").
export interface CreatedListing {
  id: string;
  status: ListingStatus;
}

// DELETE /listings/:id archives (soft-deletes) and returns this.
export interface ArchivedListing {
  id: string;
  status: ListingStatus;
  deletedAt: string | null;
}

// PATCH /listings/:listingId/photos/:photoId/order response.
export interface ReorderedListingPhoto {
  id: string;
  displayOrder: number;
}

// DELETE /listings/:listingId/photos/:photoId response.
export interface DeletedListingPhoto {
  id: string;
  status: string;
  legacy?: boolean;
}

// POST /uploads/presigned-url response (MediaService.createIntent). There is no
// `fileUrl`: a durable, renderable URL exists only after the media processor
// produces a ready derivative.
export interface PresignedUpload {
  uploadIntentId: string;
  uploadUrl: string;
  storagePath: string;
  expiresAt: string;
  maxBytes: number;
}

// MediaAssetStatus (prisma enum). A successful storage PUT reaches
// `uploaded`/`pending_upload`; only `ready` yields renderable derivatives.
export type UploadAssetStatus =
  | "pending_upload"
  | "uploaded"
  | "processing"
  | "ready"
  | "rejected"
  | "deleted";

export interface UploadAssetVariant {
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  contentType: string;
}

// GET /uploads/:intentId and POST /uploads/:intentId/complete response
// (MediaService.getSafeAsset).
export interface UploadAsset {
  id: string;
  purpose: string;
  listingId: string | null;
  status: UploadAssetStatus;
  expiresAt: string;
  uploadedAt: string | null;
  processedAt: string | null;
  rejectionCode: string | null;
  variants: UploadAssetVariant[];
}

// --- Admin moderation (see medicn/apps/api/src/admin) ---

// Host identity fields the admin endpoints expose for moderation. Distinct from
// the public ListingHostSummary — includes email and lastName.
export interface AdminListingHost {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

// Mirrors AdminService.toListingDto — note: no stayDurations; has createdAt.
export interface AdminListing {
  id: string;
  title: string;
  city: string;
  priceCents: number;
  currency: string;
  priceUnit: PriceUnit;
  status: ListingStatus;
  // Backend geocode status for the listing's location (safe summary only).
  locationStatus?: string;
  coverPhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  host: AdminListingHost;
}

// Matches ModerateListingDto: status is exactly approved|rejected, note ≤1000.
export interface ModerateListingInput {
  status: "approved" | "rejected";
  note?: string;
}
