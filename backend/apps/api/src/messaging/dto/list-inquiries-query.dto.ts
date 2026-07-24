import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

function optionalNumber(value: unknown) {
  return value === undefined || value === null || value === ""
    ? undefined
    : Number(value);
}

function optionalBoolean(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

export class ListInquiriesQueryDto {
  @IsOptional()
  @IsIn(["open", "closed"])
  status?: "open" | "closed";

  @Transform(({ value }) => optionalBoolean(value))
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

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
