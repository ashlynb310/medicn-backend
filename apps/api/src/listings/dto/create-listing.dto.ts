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
export const CHECKOUT_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
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
  @Matches(CIVIL_DATE_PATTERN)
  startDate!: string;

  @Matches(CIVIL_DATE_PATTERN)
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
  @IsString()
  @MaxLength(64)
  timeZone!: string;

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
