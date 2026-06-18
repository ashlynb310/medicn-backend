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
import { SearchListingsQueryDto } from "./dto/search-listings-query.dto";
import { UpdateListingDto } from "./dto/update-listing.dto";
import { ListingsService } from "./listings.service";

@Controller("listings")
export class ListingsController {
  constructor(
    private readonly authService: AuthService,
    private readonly listingsService: ListingsService
  ) {}

  @Get()
  async searchListings(@Query() query: SearchListingsQueryDto) {
    return this.listingsService.searchListings(query);
  }

  @Get(":id")
  async getListing(@Param("id") id: string) {
    return this.listingsService.getListing(id);
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
