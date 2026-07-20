import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { CreatePresignedUploadDto } from "./dto/create-presigned-upload.dto";
import { UploadsService } from "./uploads.service";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly authService: AuthService,
    private readonly uploadsService: UploadsService
  ) {}

  @Post("presigned-url")
  @RateLimit("upload_intent")
  async createPresignedUploadUrl(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreatePresignedUploadDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.uploadsService.createPresignedUploadUrl(token, body);
  }

  @Post(":intentId/complete")
  async complete(
    @Headers("authorization") authorization: string | undefined,
    @Param("intentId") intentId: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.uploadsService.complete(token, intentId);
  }

  @Get(":intentId")
  async status(
    @Headers("authorization") authorization: string | undefined,
    @Param("intentId") intentId: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.uploadsService.status(token, intentId);
  }

  @Delete(":assetId")
  async remove(
    @Headers("authorization") authorization: string | undefined,
    @Param("assetId") assetId: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.uploadsService.remove(token, assetId);
  }
}
