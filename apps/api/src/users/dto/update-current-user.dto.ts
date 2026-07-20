import { Transform } from "class-transformer";
import {
  IsIn,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf
} from "class-validator";

const healthcareRoleValues = [
  "medical_student",
  "nursing_student",
  "nurse",
  "resident_physician",
  "physician",
  "other"
] as const;

function trimStringOrNull(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export class UpdateCurrentUserDto {
  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(100)
  firstName?: string | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(100)
  lastName?: string | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn(healthcareRoleValues)
  healthcareRole?: (typeof healthcareRoleValues)[number] | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(200)
  healthcareAffiliation?: string | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(40)
  phoneNumber?: string | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @Transform(({ value }) => trimStringOrNull(value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  profilePhotoUrl?: string | null;
}
