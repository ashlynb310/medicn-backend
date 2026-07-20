import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MediaPurpose, MediaVariantType } from "@prisma/client";
import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import type {
  AllowedMediaContentType,
  ProcessedMedia,
  ProcessedVariant
} from "./media.types";

type AcceptedFormat = "jpeg" | "png" | "webp";

const MIME_BY_FORMAT: Record<AcceptedFormat, AllowedMediaContentType> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export class MediaRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MediaRejectedError";
  }
}

@Injectable()
export class ImageProcessorService {
  constructor(private readonly config: ConfigService) {}

  async process(
    input: Buffer,
    purpose: MediaPurpose,
    claimedContentType: string
  ): Promise<ProcessedMedia> {
    if (input.length > this.maxInputBytes(purpose)) {
      throw new MediaRejectedError("INPUT_TOO_LARGE", "Image exceeds the byte limit.");
    }
    const magicFormat = this.magicFormat(input);
    if (!magicFormat) {
      throw new MediaRejectedError("UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP images are accepted.");
    }
    if (MIME_BY_FORMAT[magicFormat] !== claimedContentType) {
      throw new MediaRejectedError("MIME_MISMATCH", "The image content does not match its claimed MIME type.");
    }

    let image: Sharp;
    let metadata: Awaited<ReturnType<Sharp["metadata"]>>;
    try {
      image = sharp(input, {
        animated: true,
        failOn: "error",
        limitInputPixels: this.maxInputPixels()
      });
      metadata = await image.metadata();
    } catch {
      throw new MediaRejectedError("INVALID_IMAGE", "The image could not be decoded safely.");
    }

    const detectedFormat = metadata.format as AcceptedFormat | undefined;
    if (!detectedFormat || !(detectedFormat in MIME_BY_FORMAT)) {
      throw new MediaRejectedError("UNSUPPORTED_FORMAT", "The decoded image format is not accepted.");
    }
    if (detectedFormat !== magicFormat) {
      throw new MediaRejectedError("FORMAT_MISMATCH", "The image signature and decoder format disagree.");
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new MediaRejectedError("MULTI_FRAME_IMAGE", "Animated or multi-page images are not accepted.");
    }
    if (!metadata.width || !metadata.height) {
      throw new MediaRejectedError("INVALID_DIMENSIONS", "The image has no valid dimensions.");
    }
    const maxDimension = this.maxDimension();
    if (metadata.width > maxDimension || metadata.height > maxDimension) {
      throw new MediaRejectedError("DIMENSIONS_TOO_LARGE", "The image dimensions exceed the configured limit.");
    }

    let normalized: Buffer;
    try {
      // rotate() applies EXIF orientation. Sharp strips EXIF/GPS/ICC/comments by
      // default because neither keepMetadata() nor withMetadata() is called.
      normalized = await image.rotate().toBuffer();
    } catch {
      throw new MediaRejectedError("INVALID_IMAGE", "The image could not be normalized safely.");
    }
    const normalizedMetadata = await sharp(normalized, {
      limitInputPixels: this.maxInputPixels()
    }).metadata();
    const width = normalizedMetadata.width;
    const height = normalizedMetadata.height;
    if (!width || !height) {
      throw new MediaRejectedError("INVALID_DIMENSIONS", "The normalized image has no valid dimensions.");
    }

    const variants = purpose === MediaPurpose.listing_photo
      ? await Promise.all([
          this.listingVariant(normalized, MediaVariantType.listing_thumbnail, 480),
          this.listingVariant(normalized, MediaVariantType.listing_display, 1600)
        ])
      : purpose === MediaPurpose.healthcare_credential
        ? [await this.listingVariant(
            normalized,
            MediaVariantType.healthcare_review,
            2000
          )]
      : await Promise.all([
          this.profileVariant(normalized, width, height, MediaVariantType.profile_small, 96),
          this.profileVariant(normalized, width, height, MediaVariantType.profile_medium, 256),
          this.profileVariant(normalized, width, height, MediaVariantType.profile_large, 512)
        ]);

    return {
      checksumSha256: this.checksum(input),
      detectedContentType: MIME_BY_FORMAT[detectedFormat],
      detectedFormat,
      decodedWidth: width,
      decodedHeight: height,
      variants
    };
  }

  private async listingVariant(
    input: Buffer,
    type: MediaVariantType,
    size: number
  ) {
    const buffer = await sharp(input, { limitInputPixels: this.maxInputPixels() })
      .resize({
        width: size,
        height: size,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    return this.variant(type, buffer);
  }

  private async profileVariant(
    input: Buffer,
    width: number,
    height: number,
    type: MediaVariantType,
    requestedSize: number
  ) {
    const size = Math.min(requestedSize, width, height);
    const buffer = await sharp(input, { limitInputPixels: this.maxInputPixels() })
      .resize({ width: size, height: size, fit: "cover", position: "centre" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    return this.variant(type, buffer);
  }

  private async variant(type: MediaVariantType, buffer: Buffer): Promise<ProcessedVariant> {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height || metadata.format !== "webp") {
      throw new Error("Generated media variant failed validation.");
    }
    return {
      type,
      buffer,
      width: metadata.width,
      height: metadata.height,
      contentType: "image/webp",
      checksumSha256: this.checksum(buffer)
    };
  }

  private magicFormat(input: Buffer): AcceptedFormat | null {
    if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "jpeg";
    if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
    if (input.length >= 12 && input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP") return "webp";
    return null;
  }

  private checksum(input: Buffer) {
    return createHash("sha256").update(input).digest("hex");
  }

  private maxInputBytes(purpose: MediaPurpose) {
    if (purpose === MediaPurpose.healthcare_credential) {
      return this.config.get<number>("HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES") ?? 10_485_760;
    }
    return this.config.get<number>("MEDIA_MAX_INPUT_BYTES") ?? 5_242_880;
  }

  private maxInputPixels() {
    return this.config.get<number>("MEDIA_MAX_INPUT_PIXELS") ?? 40_000_000;
  }

  private maxDimension() {
    return this.config.get<number>("MEDIA_MAX_DIMENSION") ?? 12_000;
  }
}
