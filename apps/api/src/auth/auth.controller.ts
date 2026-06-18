import { Controller, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("me")
  async getCurrentUser(@Headers("authorization") authorization?: string) {
    const token = this.authService.extractBearerToken(authorization);
    return this.authService.getCurrentUser(token);
  }

  @Post("sync")
  async syncCurrentUser(@Headers("authorization") authorization?: string) {
    const token = this.authService.extractBearerToken(authorization);
    return this.authService.syncCurrentUser(token);
  }
}
