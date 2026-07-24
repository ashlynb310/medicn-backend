import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
  ValidateNested
} from "class-validator";
import { CIVIL_DATE_PATTERN } from "../availability-calendar";
import {
  listingTypeValues,
  CHECKOUT_TIME_PATTERN,
  priceUnitValues,
  proximityTagValues,
  specialFeatureValues,
  stayDurationValues,
  trimString
} from "./create-listing.dto";

function toOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

function toOptionalStringArray(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(trimString);
  }

  return [trimString(value)];
}

export class UpdateListingAvailabilityDto {
  @Matches(CIVIL_DATE_PATTERN)
  startDate!: string;

  @Matches(CIVIL_DATE_PATTERN)
  endDate!: string;
}

export class UpdateListingDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(140)
  title?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;

  @IsOptional()
  @Matches(CHECKOUT_TIME_PATTERN)
  checkoutTime?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  placeId?: string;

  @IsOptional()
  @IsEmpty({ message: "latitude must not be supplied" })
  latitude?: number;

  @IsOptional()
  @IsEmpty({ message: "longitude must not be supplied" })
  longitude?: number;

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsIn(priceUnitValues)
  priceUnit?: (typeof priceUnitValues)[number];

  @IsOptional()
  @IsIn(listingTypeValues)
  listingType?: (typeof listingTypeValues)[number];

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @Transform(({ value }) => toOptionalStringArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(stayDurationValues, { each: true })
  stayDurations?: Array<(typeof stayDurationValues)[number]>;

  @Transform(({ value }) => toOptionalStringArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(proximityTagValues, { each: true })
  proximityTags?: Array<(typeof proximityTagValues)[number]>;

  @Transform(({ value }) => toOptionalStringArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(specialFeatureValues, { each: true })
  specialFeatures?: Array<(typeof specialFeatureValues)[number]>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UpdateListingAvailabilityDto)
  availability?: UpdateListingAvailabilityDto[];

  @Transform(({ value }) => toOptionalStringArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  neighborhoodPerks?: string[];

  @Transform(({ value }) => toOptionalStringArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  localRecommendations?: string[];
}
