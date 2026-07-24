export type ApiErrorCode =
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
  | "INVALID_VERIFF_SIGNATURE"
  | "INVALID_WEBHOOK_PAYLOAD"
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
  | "METRICS_UNAUTHORIZED"
  | "TRANSFER_ALREADY_RELEASED"
  | "TRANSFER_FAILED"
  | "TRANSFER_NOT_ELIGIBLE"
  | "VERIFF_NOT_CONFIGURED"
  | "VERIFF_PROVIDER_UNAVAILABLE"
  | "WEBHOOK_UNAUTHORIZED"
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
  | "WEBHOOK_SIGNATURE_INVALID"
  | "RATE_LIMITED"
  | "INTERNAL_SERVER_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export type ApiResponse<TData, TMeta = Record<string, never>> =
  | {
      data: TData;
      meta: TMeta;
      error: null;
    }
  | {
      data: null;
      meta: TMeta;
      error: ApiError;
    };

export type UserRole = "renter" | "host" | "admin";
export type HealthcareRole =
  | "medical_student"
  | "nursing_student"
  | "nurse"
  | "resident_physician"
  | "physician"
  | "other";
export type VerificationStatus =
  | "not_started"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";
export type IdentityVerificationStatus =
  | "not_started"
  | "created"
  | "submitted"
  | "review"
  | "resubmission_requested"
  | "approved"
  | "declined"
  | "expired"
  | "abandoned";

export interface CurrentUserDto {
  id: string;
  supabaseUserId: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  healthcareRole: HealthcareRole | null;
  healthcareAffiliation: string | null;
  phoneNumber: string | null;
  bio: string | null;
  profilePhotoUrl: string | null;
  profilePhoto: { url: string; source: "processed" | "legacy" } | null;
  roles: UserRole[];
  profileComplete: boolean;
  /** @deprecated Use healthcareVerification.status. */
  currentVerificationStatus: VerificationStatus;
  healthcareVerification: { status: VerificationStatus };
  identityVerification: {
    status: IdentityVerificationStatus;
    provider: "veriff";
    submittedAt: string | null;
    decidedAt: string | null;
    expiresAt: string | null;
    canRetry: boolean;
    actionRequired: "start" | "continue" | "wait" | "resubmit" | "none" | "retry";
  };
}

export type BookingStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "payment_pending"
  | "paid"
  | "completed";

export interface BookingDto {
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
  createdAt: string;
  updatedAt: string;
  cancellation?: BookingCancellationSummary | null;
  listing: {
    id: string;
    title: string;
  };
  renter: {
    id: string;
    email: string;
    firstName: string | null;
    displayName: string | null;
  };
}

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

export interface CheckoutSessionDto {
  checkoutSessionId: string;
  checkoutUrl: string;
  expiresAt: string;
}

export type SafePaymentLifecycleStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "partially_refunded"
  | "refunded"
  | "disputed";
export interface BookingPaymentSummaryDto {
  bookingId: string;
  bookingStatus: BookingStatus;
  totalAmountCents: number;
  currency: string;
  payments: Array<{
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
  }>;
  transfer: null | {
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
  };
}

export type OperationalCommandStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partially_succeeded"
  | "failed_retryable"
  | "failed_permanent";
export interface OperationalCommandDto {
  id: string;
  commandType:
    | "job_requeue"
    | "payment_reconciliation"
    | "host_transfer_reconciliation";
  source: "admin_api" | "cli";
  targetId: string | null;
  status: OperationalCommandStatus;
  batchLimit: number | null;
  staleBefore: string | null;
  counts: {
    scanned: number;
    succeeded: number;
    skipped: number;
    retryableFailures: number;
    permanentFailures: number;
    providerCalls: number;
  };
  resultCode: string | null;
  lastFailureCategory: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ListingAvailabilityStatus = "available" | "blocked";
export interface ListingAvailabilityWindowDto {
  id: string;
  startDate: string;
  endDate: string;
  status: ListingAvailabilityStatus;
}
export interface ReservedCalendarRangeDto {
  startDate: string;
  endDate: string;
  status: "reserved";
}
export interface HostListingCalendarDto {
  listingId: string;
  timeZone: string;
  range: { startDate: string; endDate: string };
  windows: ListingAvailabilityWindowDto[];
  reservations: ReservedCalendarRangeDto[];
}
export interface PublicListingCalendarDto {
  timeZone: string;
  range: { startDate: string; endDate: string };
  unavailable: Array<{ startDate: string; endDate: string }>;
}

export type InquiryStatus = "open" | "closed";

export interface SafeInquiryParticipantDto {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
}

export interface InquirySummaryDto {
  id: string;
  status: InquiryStatus;
  listing: {
    id: string;
    title: string;
    city: string;
    listingType: string;
    photoUrl: string | null;
  };
  counterpart: SafeInquiryParticipantDto | null;
  participants: {
    renter: SafeInquiryParticipantDto;
    host: SafeInquiryParticipantDto;
  };
  unreadCount: number;
  archived: boolean;
  lastReadSequence: number;
  lastSequence: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryMessageDto {
  id: string;
  sequence: number;
  sender: {
    id: string;
    displayName: string;
    role: UserRole;
  };
  isAdmin: boolean;
  body: string;
  createdAt: string;
}

export interface InquiryDetailDto {
  inquiry: InquirySummaryDto;
  messages: InquiryMessageDto[];
  pageInfo: {
    afterSequence: number;
    nextCursor: number;
    hasMore: boolean;
  };
}

export interface MessageCreatedEvent {
  eventId: string;
  inquiryId: string;
  messageId: string;
  sequence: number;
  createdAt: string;
}

export interface InquiryUpdatedEvent {
  eventId: string;
  inquiryId: string;
  status: InquiryStatus;
  lastSequence: number;
  lastMessageAt: string | null;
  updatedAt: string;
}

export interface InquiryClosedEvent {
  eventId: string;
  inquiryId: string;
  status: "closed";
  closedAt: string;
}

export interface UnreadChangedEvent {
  eventId: string;
  inquiryId: string;
  userId: string;
  updatedAt: string;
  lastReadSequence?: number;
  unreadCount?: number;
}
