import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";
import { CIVIL_DATE_PATTERN } from "../../listings/availability-calendar";

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

export class CreateBookingDto {
  @IsUUID()
  listingId!: string;

  @Matches(CIVIL_DATE_PATTERN)
  startDate!: string;

  @Matches(CIVIL_DATE_PATTERN)
  endDate!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  selectedOption!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalRequests?: string;
}
