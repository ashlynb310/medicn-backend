import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { IdentityService } from "./identity.service";
import { PublicRoute } from "../common/http/route-auth.decorator";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller()
export class IdentityController {
  constructor(
    private readonly authService: AuthService,
    private readonly identityService: IdentityService
  ) {}

  @Post("identity/verifications/session")
  @RateLimit("identity_session")
  createSession(@Headers("authorization") authorization: string | undefined) {
    const token = this.authService.extractBearerToken(authorization);
    return this.identityService.createOrReuseSession(token);
  }

  @Get("identity/verifications/current")
  getCurrent(@Headers("authorization") authorization: string | undefined) {
    const token = this.authService.extractBearerToken(authorization);
    return this.identityService.getCurrent(token);
  }

  @Post("webhooks/veriff/events")
  @PublicRoute()
  eventWebhook(
    @Headers("x-auth-client") authClient: string | undefined,
    @Headers("x-hmac-signature") signature: string | undefined,
    @Body() _body: unknown,
    @Req() request: { rawBody?: Buffer }
  ) {
    return this.webhook("event", request.rawBody, authClient, signature);
  }

  @Post("webhooks/veriff/decisions")
  @PublicRoute()
  decisionWebhook(
    @Headers("x-auth-client") authClient: string | undefined,
    @Headers("x-hmac-signature") signature: string | undefined,
    @Body() _body: unknown,
    @Req() request: { rawBody?: Buffer }
  ) {
    return this.webhook("decision", request.rawBody, authClient, signature);
  }

  private webhook(
    kind: "event" | "decision",
    rawBody: Buffer | undefined,
    authClient: string | undefined,
    signature: string | undefined
  ) {
    if (!rawBody) {
      throw new BadRequestException({
        code: "INVALID_VERIFF_SIGNATURE",
        message: "The untouched Veriff webhook body is required.",
        details: {}
      });
    }
    return this.identityService.handleWebhook(
      kind,
      rawBody,
      authClient,
      signature
    );
  }
}
