export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_SUPABASE_TOKEN"
  | "USER_NOT_SYNCED"
  | "EMAIL_NOT_VERIFIED"
  | "VERIFICATION_REQUIRED"
  | "LISTING_NOT_AVAILABLE"
  | "BOOKING_NOT_AVAILABLE"
  | "PAYMENT_FAILED"
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
  roles: UserRole[];
  profileComplete: boolean;
  currentVerificationStatus: VerificationStatus;
}
