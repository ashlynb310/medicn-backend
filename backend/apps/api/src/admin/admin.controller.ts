import { Body, Controller, Get, Headers, Param, Patch, Query } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { AdminService } from "./admin.service";
import { ListAdminListingsQueryDto } from "./dto/list-admin-listings-query.dto";
import { ModerateListingDto } from "./dto/moderate-listing.dto";

@Controller("admin/listings")
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminService: AdminService
  ) {}

  @Get()
  async listListings(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListAdminListingsQueryDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.adminService.listListings(token, query);
  }

  @Patch(":id/status")
  async moderateListing(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: ModerateListingDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.adminService.moderateListing(token, id, body);
  }
}
