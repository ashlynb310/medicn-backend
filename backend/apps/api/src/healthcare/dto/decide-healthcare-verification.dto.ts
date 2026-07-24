import { Transform } from "class-transformer";
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { HealthcareDecisionReasonCode } from "@prisma/client";

export class DecideHealthcareVerificationDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsEnum(HealthcareDecisionReasonCode)
  reasonCode!: HealthcareDecisionReasonCode;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
