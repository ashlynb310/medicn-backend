import { Body, Controller, Delete, Headers, Param, Patch } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { ReorderMediaDto } from "./dto/reorder-media.dto";
import { MediaService } from "./media.service";

@Controller()
export class MediaController {
  constructor(
    private readonly authService: AuthService,
    private readonly mediaService: MediaService
  ) {}

  @Patch("listings/:listingId/photos/:photoId/order")
  async reorder(
    @Headers("authorization") authorization: string | undefined,
    @Param("listingId") listingId: string,
    @Param("photoId") photoId: string,
    @Body() body: ReorderMediaDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.reorderListingPhoto(
      user,
      listingId,
      photoId,
      body.displayOrder
    );
  }

  @Delete("listings/:listingId/photos/:photoId")
  async deleteListingPhoto(
    @Headers("authorization") authorization: string | undefined,
    @Param("listingId") listingId: string,
    @Param("photoId") photoId: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.deleteListingPhoto(user, listingId, photoId);
  }

  @Delete("users/me/profile-photo")
  async removeProfile(
    @Headers("authorization") authorization: string | undefined
  ) {
    const token = this.authService.extractBearerToken(authorization);
    const user = await this.authService.getCurrentUserRecord(token);
    return this.mediaService.removeActiveProfile(user);
  }
}
