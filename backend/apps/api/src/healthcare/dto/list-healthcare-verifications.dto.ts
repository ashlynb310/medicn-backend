import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import {
  HealthcareEvidenceCategory,
  HealthcareRole,
  HealthcareSubmissionStatus
} from "@prisma/client";

const optionalNumber = (value: unknown) =>
  value === undefined || value === null || value === "" ? undefined : Number(value);

export class ListHealthcareVerificationsDto {
  @IsOptional()
  @IsEnum(HealthcareSubmissionStatus)
  status?: HealthcareSubmissionStatus;

  @IsOptional()
  @IsEnum(HealthcareRole)
  role?: HealthcareRole;

  @IsOptional()
  @IsEnum(HealthcareEvidenceCategory)
  evidenceCategory?: HealthcareEvidenceCategory;

  @Transform(({ value }) => optionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }) => optionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
