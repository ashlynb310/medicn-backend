import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { DecideHealthcareVerificationDto } from "./dto/decide-healthcare-verification.dto";
import { ListHealthcareVerificationsDto } from "./dto/list-healthcare-verifications.dto";
import { HealthcareAdminService } from "./healthcare-admin.service";

@Controller("admin/healthcare-verifications")
export class HealthcareAdminController {
  constructor(
    private readonly auth: AuthService,
    private readonly healthcare: HealthcareAdminService
  ) {}

  @Get()
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListHealthcareVerificationsDto
  ) {
    return this.healthcare.list(this.auth.extractBearerToken(authorization), query);
  }

  @Get(":id")
  detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    return this.healthcare.detail(this.auth.extractBearerToken(authorization), id);
  }

  @Post(":id/evidence/:evidenceId/view-url")
  viewEvidence(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string
  ) {
    return this.healthcare.viewEvidence(
      this.auth.extractBearerToken(authorization),
      id,
      evidenceId
    );
  }

  @Patch(":id")
  decide(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: DecideHealthcareVerificationDto
  ) {
    return this.healthcare.decide(this.auth.extractBearerToken(authorization), id, body);
  }
}
