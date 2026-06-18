import { Body, Controller, Headers, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { CreatePresignedUploadDto } from "./dto/create-presigned-upload.dto";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly authService: AuthService,
    private readonly uploadsService: UploadsService
  ) {}

  @Post("presigned-url")
  async createPresignedUploadUrl(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreatePresignedUploadDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.uploadsService.createPresignedUploadUrl(token, body);
  }
}
