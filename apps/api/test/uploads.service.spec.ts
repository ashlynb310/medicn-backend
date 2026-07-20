import { MediaPurpose, UserRole } from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { MediaService } from "../src/media/media.service";
import { UploadsService } from "../src/uploads/uploads.service";

const user = {
  id: "user_1",
  roles: [UserRole.host]
};

function createService() {
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(user) };
  const media = {
    createIntent: jest.fn(),
    completeIntent: jest.fn(),
    getIntent: jest.fn(),
    deleteAsset: jest.fn()
  };
  return {
    service: new UploadsService(
      auth as unknown as AuthService,
      media as unknown as MediaService
    ),
    auth,
    media
  };
}

describe("UploadsService", () => {
  it("creates a durable profile intent without constructing a public URL", async () => {
    const { service, media } = createService();
    media.createIntent.mockResolvedValue({
      uploadIntentId: "asset_1",
      uploadUrl: "https://signed.example/upload",
      storagePath: "product-media/profile_photo/user_1/asset_1/photo.png",
      expiresAt: "2026-07-19T01:00:00.000Z",
      maxBytes: 5_242_880
    });
    const result = await service.createPresignedUploadUrl("token", {
      purpose: "profile_photo",
      fileName: "photo.png",
      contentType: "image/png"
    });
    expect(result).not.toHaveProperty("fileUrl");
    expect(media.createIntent).toHaveBeenCalledWith(user, {
      purpose: MediaPurpose.profile_photo,
      listingId: undefined,
      fileName: "photo.png",
      contentType: "image/png"
    });
  });

  it("delegates completion and status to the authorized durable asset", async () => {
    const { service, media } = createService();
    media.completeIntent.mockResolvedValue({ id: "asset_1", status: "uploaded" });
    media.getIntent.mockResolvedValue({ id: "asset_1", status: "processing" });
    await expect(service.complete("token", "asset_1")).resolves.toMatchObject({ status: "uploaded" });
    await expect(service.status("token", "asset_1")).resolves.toMatchObject({ status: "processing" });
    expect(media.completeIntent).toHaveBeenCalledWith(user, "asset_1");
    expect(media.getIntent).toHaveBeenCalledWith(user, "asset_1");
  });

  it("deletes by asset ID rather than accepting a browser storage path", async () => {
    const { service, media } = createService();
    media.deleteAsset.mockResolvedValue({ id: "asset_1", status: "deleted" });
    await service.remove("token", "asset_1");
    expect(media.deleteAsset).toHaveBeenCalledWith(user, "asset_1");
  });
});
