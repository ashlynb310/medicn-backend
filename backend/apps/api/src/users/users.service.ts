import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { HealthcareRole } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { MediaService } from "../media/media.service";
import type { UpdateCurrentUserDto } from "./dto/update-current-user.dto";

type CurrentUserDto = ReturnType<AuthService["toCurrentUserDto"]>;

type PublicUserDto = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  healthcareRole: HealthcareRole | null;
  roles: Array<"renter" | "host" | "admin">;
  bio: string | null;
  profilePhotoUrl: string | null;
  profilePhoto: { url: string; source: "processed" | "legacy" } | null;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @Optional() private readonly mediaService?: MediaService
  ) {}

  async getPublicUser(id: string): Promise<PublicUserDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        disabledAt: null
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        healthcareRole: true,
        roles: true,
        bio: true,
        profilePhotoUrl: true,
        activeProfileMediaAssetId: true
      }
    });

    if (!user) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "User was not found.",
        details: {}
      });
    }

    const { activeProfileMediaAssetId, ...publicUser } = user;
    return {
      ...publicUser,
      profilePhoto: user.profilePhotoUrl
        ? {
            url: user.profilePhotoUrl,
            source: activeProfileMediaAssetId ? "processed" as const : "legacy" as const
          }
        : null
    };
  }

  async updateCurrentUser(
    token: string,
    input: UpdateCurrentUserDto
  ): Promise<CurrentUserDto> {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    if (input.profilePhotoUrl !== undefined && input.profilePhotoUrl !== null) {
      throw new BadRequestException({
        code: "MEDIA_PROCESSING_REQUIRED",
        message: "Profile photos must use the media upload workflow.",
        details: {}
      });
    }
    if (input.profilePhotoUrl === null && this.mediaService) {
      await this.mediaService.removeActiveProfile(currentUser);
    }
    const data = this.toProfileUpdateData(input);

    if (Object.keys(data).length === 0) {
      if (input.profilePhotoUrl === null && this.mediaService) {
        const refreshed = await this.prisma.user.findUniqueOrThrow({
          where: { id: currentUser.id }
        });
        return this.authService.toCurrentUserDto(refreshed);
      }
      return this.authService.toCurrentUserDto(currentUser);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: currentUser.id },
      data
    });

    return this.authService.toCurrentUserDto(updatedUser);
  }

  private toProfileUpdateData(input: UpdateCurrentUserDto) {
    return {
      ...this.optionalNullableString("firstName", input.firstName),
      ...this.optionalNullableString("lastName", input.lastName),
      ...this.optionalNullableString("displayName", input.displayName),
      ...this.optionalHealthcareRole(input.healthcareRole),
      ...this.optionalNullableString(
        "healthcareAffiliation",
        input.healthcareAffiliation
      ),
      ...this.optionalNullableString("phoneNumber", input.phoneNumber),
      ...this.optionalNullableString("bio", input.bio),
      ...(input.profilePhotoUrl === null && !this.mediaService
        ? { profilePhotoUrl: null, activeProfileMediaAssetId: null }
        : {})
    };
  }

  private optionalNullableString(key: string, value: string | null | undefined) {
    if (value === undefined) {
      return {};
    }

    if (value === null) {
      return { [key]: null };
    }

    const trimmed = value.trim();
    return { [key]: trimmed.length === 0 ? null : trimmed };
  }

  private optionalHealthcareRole(value: UpdateCurrentUserDto["healthcareRole"]) {
    if (value === undefined) {
      return {};
    }

    if (value === null) {
      return { healthcareRole: null };
    }

    return { healthcareRole: HealthcareRole[value] };
  }
}
