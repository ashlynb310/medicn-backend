import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export const priceUnitValues = ["day", "night", "month"] as const;
export const listingTypeValues = [
  "private_room",
  "entire_home",
  "shared_room"
] as const;
export const stayDurationValues = [
  "short_term",
  "medium_term",
  "long_term"
] as const;
export const proximityTagValues = ["near_hospitals", "public_transit"] as const;
export const specialFeatureValues = [
  "fully_furnished",
  "pet_friendly",
  "access_24_7"
] as const;

export function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

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

export class ListingAvailabilityDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

export class CreateListingDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(140)
  title!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(5000)
  description!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  city!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @Transform(({ value }) => toOptionalNumber(value))
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsIn(priceUnitValues)
  priceUnit!: (typeof priceUnitValues)[number];

  @IsIn(listingTypeValues)
  listingType!: (typeof listingTypeValues)[number];

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
  @Type(() => ListingAvailabilityDto)
  availability?: ListingAvailabilityDto[];

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
