import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

const listingStatusValues = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "hidden"
] as const;

function toOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

export class ListMyListingsQueryDto {
  @IsOptional()
  @IsIn(listingStatusValues)
  status?: (typeof listingStatusValues)[number];

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
