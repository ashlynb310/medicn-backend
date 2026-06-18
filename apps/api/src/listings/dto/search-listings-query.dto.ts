import { Transform } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from "class-validator";
import {
  listingTypeValues,
  priceUnitValues,
  stayDurationValues,
  trimString
} from "./create-listing.dto";

const sortValues = ["newest", "price_asc", "price_desc"] as const;

function toOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

export class SearchListingsQueryDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nearbyHospital?: string;

  @IsOptional()
  @IsIn(listingTypeValues)
  listingType?: (typeof listingTypeValues)[number];

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsIn(stayDurationValues)
  stayDuration?: (typeof stayDurationValues)[number];

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsIn(priceUnitValues)
  priceUnit?: (typeof priceUnitValues)[number];

  @IsOptional()
  @IsIn(sortValues)
  sort?: (typeof sortValues)[number];

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

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bounds?: string;
}
