import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { trimString } from "./create-listing.dto";

export class AddListingPhotoDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(512)
  storagePath!: string;

  @Transform(({ value }) =>
    value === undefined || value === null || value === "" ? undefined : Number(value)
  )
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
