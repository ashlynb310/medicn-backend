import { ConfigService } from "@nestjs/config";
import { MediaPurpose, MediaVariantType } from "@prisma/client";
import sharp from "sharp";
import {
  ImageProcessorService,
  MediaRejectedError
} from "../src/media/image-processor.service";

describe("ImageProcessorService", () => {
  const processor = new ImageProcessorService(new ConfigService({
    MEDIA_MAX_INPUT_BYTES: 5_242_880,
    MEDIA_MAX_INPUT_PIXELS: 40_000_000,
    MEDIA_MAX_DIMENSION: 12_000
  }));

  it("rejects arbitrary bytes and MIME mismatches", async () => {
    await expect(processor.process(
      Buffer.from("not really a jpeg"),
      MediaPurpose.listing_photo,
      "image/jpeg"
    )).rejects.toMatchObject<Partial<MediaRejectedError>>({ code: "UNSUPPORTED_FORMAT" });

    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "red" }
    }).png().toBuffer();
    await expect(processor.process(
      png,
      MediaPurpose.listing_photo,
      "image/jpeg"
    )).rejects.toMatchObject<Partial<MediaRejectedError>>({ code: "MIME_MISMATCH" });
  });

  it("re-encodes listing variants without upscaling", async () => {
    const source = await sharp({
      create: { width: 320, height: 200, channels: 3, background: "blue" }
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processor.process(
      source,
      MediaPurpose.listing_photo,
      "image/jpeg"
    );
    expect(result.decodedWidth).toBe(200);
    expect(result.decodedHeight).toBe(320);
    expect(result.variants.map((variant) => variant.type)).toEqual([
      MediaVariantType.listing_thumbnail,
      MediaVariantType.listing_display
    ]);
    for (const variant of result.variants) {
      expect([variant.width, variant.height]).toEqual([200, 320]);
      const metadata = await sharp(variant.buffer).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
  });

  it("center-crops profile variants and never upscales", async () => {
    const source = await sharp({
      create: { width: 300, height: 180, channels: 3, background: "green" }
    }).webp().toBuffer();
    const result = await processor.process(
      source,
      MediaPurpose.profile_photo,
      "image/webp"
    );
    expect(result.variants.map(({ width, height }) => [width, height])).toEqual([
      [96, 96],
      [180, 180],
      [180, 180]
    ]);
  });

  it("creates one private healthcare review derivative with metadata removed", async () => {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: "white" }
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processor.process(
      source,
      MediaPurpose.healthcare_credential,
      "image/jpeg"
    );

    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]?.type).toBe(MediaVariantType.healthcare_review);
    expect(Math.max(result.variants[0]?.width ?? 0, result.variants[0]?.height ?? 0))
      .toBeLessThanOrEqual(2000);
    const metadata = await sharp(result.variants[0]!.buffer).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect((metadata as typeof metadata & { gps?: unknown }).gps).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("enforces maximum dimensions", async () => {
    const strict = new ImageProcessorService(new ConfigService({
      MEDIA_MAX_INPUT_BYTES: 5_242_880,
      MEDIA_MAX_INPUT_PIXELS: 40_000_000,
      MEDIA_MAX_DIMENSION: 100
    }));
    const source = await sharp({
      create: { width: 101, height: 10, channels: 3, background: "black" }
    }).png().toBuffer();
    await expect(strict.process(
      source,
      MediaPurpose.listing_photo,
      "image/png"
    )).rejects.toMatchObject<Partial<MediaRejectedError>>({ code: "DIMENSIONS_TOO_LARGE" });
  });

  it("rejects animated WebP even though static WebP is allowed", async () => {
    const red = await sharp({
      create: { width: 10, height: 10, channels: 4, background: "red" }
    }).png().toBuffer();
    const blue = await sharp({
      create: { width: 10, height: 10, channels: 4, background: "blue" }
    }).png().toBuffer();
    const animated = await sharp([red, blue], { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    await expect(processor.process(
      animated,
      MediaPurpose.profile_photo,
      "image/webp"
    )).rejects.toMatchObject<Partial<MediaRejectedError>>({ code: "MULTI_FRAME_IMAGE" });
  });

  it("enforces byte and decoded-pixel limits", async () => {
    const source = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" }
    }).png().toBuffer();
    const byteLimited = new ImageProcessorService(new ConfigService({
      MEDIA_MAX_INPUT_BYTES: source.length - 1,
      MEDIA_MAX_INPUT_PIXELS: 40_000_000,
      MEDIA_MAX_DIMENSION: 12_000
    }));
    await expect(byteLimited.process(
      source,
      MediaPurpose.listing_photo,
      "image/png"
    )).rejects.toMatchObject<Partial<MediaRejectedError>>({ code: "INPUT_TOO_LARGE" });

    const pixelLimited = new ImageProcessorService(new ConfigService({
      MEDIA_MAX_INPUT_BYTES: 5_242_880,
      MEDIA_MAX_INPUT_PIXELS: 399,
      MEDIA_MAX_DIMENSION: 12_000
    }));
    await expect(pixelLimited.process(
      source,
      MediaPurpose.listing_photo,
      "image/png"
    )).rejects.toMatchObject<Partial<MediaRejectedError>>({ code: "INVALID_IMAGE" });
  });
});
