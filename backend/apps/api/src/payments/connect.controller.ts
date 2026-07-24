import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { ConnectService } from "./connect.service";
import {
  ConnectAccountTargetDto,
  CreateConnectedAccountDto
} from "./dto/connect-account.dto";

@Controller("connect")
export class ConnectController {
  constructor(
    private readonly authService: AuthService,
    private readonly connectService: ConnectService
  ) {}

  @Post("account")
  createOrReuseAccount(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateConnectedAccountDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.connectService.createOrReuseAccount(token, body);
  }

  @Post("onboarding-link")
  createOnboardingLink(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ConnectAccountTargetDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.connectService.createOnboardingLink(token, body);
  }

  @Get("account")
  synchronizeAccount(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ConnectAccountTargetDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.connectService.synchronizeAccount(token, query);
  }

  @Post("management-link")
  createManagementLink(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ConnectAccountTargetDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.connectService.createManagementLink(token, body);
  }
}
