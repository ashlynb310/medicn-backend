import { Injectable } from "@nestjs/common";
import { HealthcareRole } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateCurrentUserDto } from "./dto/update-current-user.dto";

type CurrentUserDto = ReturnType<AuthService["toCurrentUserDto"]>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  async updateCurrentUser(
    token: string,
    input: UpdateCurrentUserDto
  ): Promise<CurrentUserDto> {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const data = this.toProfileUpdateData(input);

    if (Object.keys(data).length === 0) {
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
      ...this.optionalNullableString("profilePhotoUrl", input.profilePhotoUrl)
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
