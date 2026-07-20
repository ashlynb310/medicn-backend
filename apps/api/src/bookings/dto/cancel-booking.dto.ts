import { Transform } from "class-transformer";
import { IsIn, IsString } from "class-validator";

export const CANCELLATION_REQUEST_REASONS = [
  "plans_changed",
  "booking_no_longer_needed",
  "property_unavailable",
  "cannot_accommodate",
  "safety_issue",
  "support_resolution",
  "fraud_risk",
  "provider_failure",
  "other"
] as const;

export type CancellationRequestReason =
  (typeof CANCELLATION_REQUEST_REASONS)[number];

export class CancelBookingDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @IsIn(CANCELLATION_REQUEST_REASONS)
  reason!: CancellationRequestReason;
}
