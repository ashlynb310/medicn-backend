import { Transform } from "class-transformer";
import { IsEnum, IsString, MaxLength, MinLength } from "class-validator";
import {
  HealthcareAffiliationType,
  HealthcareEvidenceCategory,
  HealthcareRole
} from "@prisma/client";

export class CreateHealthcareVerificationDto {
  @IsEnum(HealthcareRole)
  claimedRole!: HealthcareRole;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  claimedAffiliationName!: string;

  @IsEnum(HealthcareAffiliationType)
  claimedAffiliationType!: HealthcareAffiliationType;

  @IsEnum(HealthcareEvidenceCategory)
  evidenceCategory!: HealthcareEvidenceCategory;
}
