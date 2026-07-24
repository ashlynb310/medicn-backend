import { IsIn } from "class-validator";

const bookingDecisionStatusValues = ["accepted", "rejected"] as const;

export class UpdateBookingStatusDto {
  @IsIn(bookingDecisionStatusValues)
  status!: (typeof bookingDecisionStatusValues)[number];
}
