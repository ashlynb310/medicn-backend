import { Injectable } from "@nestjs/common";
import { MediaPurpose } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { MediaService } from "../media/media.service";
import type { CreatePresignedUploadDto } from "./dto/create-presigned-upload.dto";

@Injectable()
export class UploadsService {
  constructor(
    private readonly authService: AuthService,
    private readonly mediaService: MediaService
  ) {}

  async createPresignedUploadUrl(token: string, input: CreatePresignedUploadDto) {
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.createIntent(user, {
      purpose: input.purpose as MediaPurpose,
      listingId: input.listingId,
      fileName: input.fileName,
      contentType: input.contentType
    });
  }

  async complete(token: string, intentId: string) {
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.completeIntent(user, intentId);
  }

  async status(token: string, intentId: string) {
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.getIntent(user, intentId);
  }

  async remove(token: string, assetId: string) {
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.deleteAsset(user, assetId);
  }
}
