import { Body, Controller, Get, Headers, Param, Patch } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { UpdateCurrentUserDto } from "./dto/update-current-user.dto";
import { UsersService } from "./users.service";
import { PublicRoute } from "../common/http/route-auth.decorator";

@Controller("users")
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService
  ) {}

  @Get(":id")
  @PublicRoute()
  async getPublicUser(@Param("id") id: string) {
    return this.usersService.getPublicUser(id);
  }

  @Patch("me")
  async updateCurrentUser(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: UpdateCurrentUserDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.usersService.updateCurrentUser(token, body);
  }
}
