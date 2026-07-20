import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { CreateHealthcareEvidenceUploadDto } from "./dto/create-healthcare-evidence-upload.dto";
import { CreateHealthcareVerificationDto } from "./dto/create-healthcare-verification.dto";
import { HealthcareVerificationService } from "./healthcare-verification.service";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller("healthcare-verifications")
export class HealthcareVerificationController {
  constructor(
    private readonly auth: AuthService,
    private readonly healthcare: HealthcareVerificationService
  ) {}

  @Post()
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateHealthcareVerificationDto
  ) {
    return this.healthcare.create(this.auth.extractBearerToken(authorization), body);
  }

  @Post(":id/evidence/upload-intents")
  @RateLimit("upload_intent")
  createUploadIntent(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: CreateHealthcareEvidenceUploadDto
  ) {
    return this.healthcare.createUploadIntent(this.auth.extractBearerToken(authorization), id, body);
  }

  @Post(":id/evidence/:evidenceId/complete")
  completeUpload(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string
  ) {
    return this.healthcare.completeUpload(this.auth.extractBearerToken(authorization), id, evidenceId);
  }

  @Post(":id/submit")
  submit(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    return this.healthcare.submit(this.auth.extractBearerToken(authorization), id);
  }

  @Get("me")
  getMine(@Headers("authorization") authorization: string | undefined) {
    return this.healthcare.getMine(this.auth.extractBearerToken(authorization));
  }

  @Post(":id/withdraw")
  withdraw(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    return this.healthcare.withdraw(this.auth.extractBearerToken(authorization), id);
  }
}
