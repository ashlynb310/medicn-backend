import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength } from "class-validator";
import { trimString } from "../../listings/dto/create-listing.dto";

const uploadPurposeValues = ["listing_photo"] as const;
const imageContentTypeValues = ["image/jpeg", "image/png", "image/webp"] as const;

export class CreatePresignedUploadDto {
  @IsIn(uploadPurposeValues)
  purpose!: (typeof uploadPurposeValues)[number];

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(80)
  listingId!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsIn(imageContentTypeValues)
  contentType!: (typeof imageContentTypeValues)[number];
}
