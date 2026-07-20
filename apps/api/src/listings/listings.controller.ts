import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { AddListingPhotoDto } from "./dto/add-listing-photo.dto";
import { CreateListingDto } from "./dto/create-listing.dto";
import { ListMyListingsQueryDto } from "./dto/list-my-listings-query.dto";
import { SearchListingsQueryDto } from "./dto/search-listings-query.dto";
import { UpdateListingDto } from "./dto/update-listing.dto";
import {
  AvailabilityPageQueryDto,
  CalendarRangeQueryDto,
  CreateAvailabilityWindowDto,
  UpdateAvailabilityWindowDto
} from "./dto/availability.dto";
import { ListingAvailabilityService } from "./listing-availability.service";
import { ListingsService } from "./listings.service";
import {
  OptionalBearerRoute,
  PublicRoute
} from "../common/http/route-auth.decorator";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller("listings")
export class ListingsController {
  constructor(
    private readonly authService: AuthService,
    private readonly listingsService: ListingsService,
    private readonly availabilityService: ListingAvailabilityService
  ) {}

  @Get()
  @PublicRoute()
  @RateLimit("public_search")
  async searchListings(@Query() query: SearchListingsQueryDto) {
    return this.listingsService.searchListings(query);
  }

  @Get("mine")
  async listMyListings(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListMyListingsQueryDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.listingsService.listMyListings(token, query);
  }

  @Get(":id")
  @OptionalBearerRoute()
  async getListing(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    const token = authorization
      ? this.authService.extractBearerToken(authorization)
      : undefined;
    return this.listingsService.getListing(id, token);
  }

  @Get(":id/calendar")
  @PublicRoute()
  @RateLimit("public_calendar")
  async getPublicCalendar(
    @Param("id") id: string,
    @Query() query: CalendarRangeQueryDto
  ) {
    return this.availabilityService.getPublicCalendar(id, query);
  }

  @Get(":id/availability")
  async listAvailability(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Query() query: AvailabilityPageQueryDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.availabilityService.listWindows(token, id, query);
  }

  @Get(":id/availability/calendar")
  async getAvailabilityCalendar(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Query() query: CalendarRangeQueryDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.availabilityService.getHostCalendar(token, id, query);
  }

  @Post(":id/availability")
  async createAvailability(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: CreateAvailabilityWindowDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.availabilityService.createWindow(token, id, body);
  }

  @Patch(":id/availability/:windowId")
  async updateAvailability(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("windowId") windowId: string,
    @Body() body: UpdateAvailabilityWindowDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.availabilityService.updateWindow(token, id, windowId, body);
  }

  @Delete(":id/availability/:windowId")
  async deleteAvailability(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("windowId") windowId: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.availabilityService.deleteWindow(token, id, windowId);
  }

  @Post()
  async createListing(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateListingDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.listingsService.createListing(token, body);
  }

  @Patch(":id")
  async updateListing(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: UpdateListingDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.listingsService.updateListing(token, id, body);
  }

  @Delete(":id")
  async deleteListing(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.listingsService.deleteListing(token, id);
  }

  @Post(":id/photos")
  async addListingPhoto(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: AddListingPhotoDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.listingsService.addListingPhoto(token, id, body);
  }
}
