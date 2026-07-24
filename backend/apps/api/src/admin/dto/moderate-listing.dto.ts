import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const moderationStatusValues = ["approved", "rejected"] as const;

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

export class ModerateListingDto {
  @IsIn(moderationStatusValues)
  status!: (typeof moderationStatusValues)[number];

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
