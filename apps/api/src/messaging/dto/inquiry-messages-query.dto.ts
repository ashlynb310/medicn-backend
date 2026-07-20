import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

const optionalNumber = (value: unknown) =>
  value === undefined || value === null || value === ""
    ? undefined
    : Number(value);

export class InquiryMessagesQueryDto {
  @Transform(({ value }) => optionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(0)
  afterSequence?: number;

  @Transform(({ value }) => optionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
