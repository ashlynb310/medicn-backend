import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import { ALLOWED_MEDIA_CONTENT_TYPES } from "../../media/media.types";

export class CreateHealthcareEvidenceUploadDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsIn(ALLOWED_MEDIA_CONTENT_TYPES)
  contentType!: "image/jpeg" | "image/png" | "image/webp";
}
