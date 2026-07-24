import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min
} from "class-validator";
import { CIVIL_DATE_PATTERN } from "../availability-calendar";
import { trimString } from "./create-listing.dto";

export const availabilityStatusValues = ["available", "blocked"] as const;

export class CreateAvailabilityWindowDto {
  @Transform(({ value }) => trimString(value))
  @Matches(CIVIL_DATE_PATTERN)
  startDate!: string;

  @Transform(({ value }) => trimString(value))
  @Matches(CIVIL_DATE_PATTERN)
  endDate!: string;

  @IsIn(availabilityStatusValues)
  status!: (typeof availabilityStatusValues)[number];
}

export class UpdateAvailabilityWindowDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  startDate?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  endDate?: string;

  @IsOptional()
  @IsIn(availabilityStatusValues)
  status?: (typeof availabilityStatusValues)[number];
}

export class AvailabilityPageQueryDto {
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CalendarRangeQueryDto {
  @Transform(({ value }) => trimString(value))
  @Matches(CIVIL_DATE_PATTERN)
  startDate!: string;

  @Transform(({ value }) => trimString(value))
  @Matches(CIVIL_DATE_PATTERN)
  endDate!: string;
}
