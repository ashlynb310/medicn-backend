import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HealthcareRole, UserRole, type User } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { PrismaService } from "../prisma/prisma.service";

export interface CurrentUserDto {
  id: string;
  supabaseUserId: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  healthcareRole:
    | "medical_student"
    | "nursing_student"
    | "nurse"
    | "resident_physician"
    | "physician"
    | "other"
    | null;
  healthcareAffiliation: string | null;
  phoneNumber: string | null;
  bio: string | null;
  profilePhotoUrl: string | null;
  roles: Array<"renter" | "host" | "admin">;
  profileComplete: boolean;
  currentVerificationStatus:
    | "not_started"
    | "pending"
    | "approved"
    | "rejected"
    | "expired";
}

interface SupabaseAuthUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

interface SupabaseAuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: SupabaseAuthUser | null };
      error: Error | null;
    }>;
  };
}

interface VerifiedSupabaseUser {
  supabaseUserId: string;
  email: string | null;
  emailVerifiedAt: Date | null | undefined;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  healthcareRole: HealthcareRole | null;
  profilePhotoUrl: string | null;
  roles: UserRole[];
}

@Injectable()
export class AuthService {
  private readonly supabase: SupabaseAuthClient | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    this.supabase = this.createSupabaseClient();
  }

  extractBearerToken(authorization?: string) {
    if (!authorization) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Missing Authorization bearer token.",
        details: {}
      });
    }

    const [scheme, token, extra] = authorization.trim().split(/\s+/);

    if (scheme !== "Bearer" || !token || extra) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Authorization header must use Bearer token format.",
        details: {}
      });
    }

    return token;
  }

  async verifyAccessToken(token: string): Promise<VerifiedSupabaseUser> {
    if (!this.supabase) {
      throw new InternalServerErrorException({
        code: "INTERNAL_SERVER_ERROR",
        message: "Supabase Auth is not configured.",
        details: {}
      });
    }

    const { data, error } = await this.supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException({
        code: "INVALID_SUPABASE_TOKEN",
        message: "Supabase access token is invalid or expired.",
        details: {}
      });
    }

    return this.toVerifiedSupabaseUser(data.user);
  }

  async getCurrentUserRecord(token: string) {
    const supabaseUser = await this.verifyAccessToken(token);
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId: supabaseUser.supabaseUserId }
    });

    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_SYNCED",
        message: "MediCN user profile has not been synced yet.",
        details: {}
      });
    }

    return user;
  }

  async getCurrentUser(token: string) {
    return this.toCurrentUserDto(await this.getCurrentUserRecord(token));
  }

  async syncCurrentUser(token: string) {
    const supabaseUser = await this.verifyAccessToken(token);

    if (!supabaseUser.email) {
      throw new UnprocessableEntityException({
        code: "VALIDATION_ERROR",
        message: "Supabase user email is required to sync a MediCN profile.",
        details: {}
      });
    }

    const metadataProfileUpdate = this.toMetadataProfileUpdate(supabaseUser);
    const authAccountUpdate = this.toAuthAccountUpdate(supabaseUser);
    const user = await this.prisma.user.upsert({
      where: { supabaseUserId: supabaseUser.supabaseUserId },
      update: {
        email: supabaseUser.email,
        ...authAccountUpdate,
        ...metadataProfileUpdate
      },
      create: {
        supabaseUserId: supabaseUser.supabaseUserId,
        email: supabaseUser.email,
        emailVerifiedAt: supabaseUser.emailVerifiedAt ?? null,
        firstName: supabaseUser.firstName,
        lastName: supabaseUser.lastName,
        displayName: supabaseUser.displayName,
        healthcareRole: supabaseUser.healthcareRole,
        profilePhotoUrl: supabaseUser.profilePhotoUrl,
        roles: supabaseUser.roles,
        profileComplete: supabaseUser.roles.length > 0
      }
    });

    return this.toCurrentUserDto(user);
  }

  private toAuthAccountUpdate(supabaseUser: VerifiedSupabaseUser) {
    return supabaseUser.emailVerifiedAt !== undefined
      ? { emailVerifiedAt: supabaseUser.emailVerifiedAt }
      : {};
  }

  private toMetadataProfileUpdate(supabaseUser: VerifiedSupabaseUser) {
    return {
      ...(supabaseUser.firstName !== null
        ? { firstName: supabaseUser.firstName }
        : {}),
      ...(supabaseUser.lastName !== null
        ? { lastName: supabaseUser.lastName }
        : {}),
      ...(supabaseUser.displayName !== null
        ? { displayName: supabaseUser.displayName }
        : {}),
      ...(supabaseUser.healthcareRole !== null
        ? { healthcareRole: supabaseUser.healthcareRole }
        : {}),
      ...(supabaseUser.profilePhotoUrl !== null
        ? { profilePhotoUrl: supabaseUser.profilePhotoUrl }
        : {})
    };
  }

  toCurrentUserDto(user: User): CurrentUserDto {
    return {
      id: user.id,
      supabaseUserId: user.supabaseUserId,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      healthcareRole: user.healthcareRole,
      healthcareAffiliation: user.healthcareAffiliation,
      phoneNumber: user.phoneNumber,
      bio: user.bio,
      profilePhotoUrl: user.profilePhotoUrl,
      roles: [...user.roles],
      profileComplete: user.profileComplete,
      currentVerificationStatus: user.currentVerificationStatus
    };
  }

  private createSupabaseClient() {
    const supabaseUrl = this.config.get<string>("NEXT_PUBLIC_SUPABASE_URL");
    const publishableKey = this.config.get<string>(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );

    if (!supabaseUrl || !publishableKey) {
      return null;
    }

    return createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    });
  }

  private toVerifiedSupabaseUser(
    supabaseUser: SupabaseAuthUser
  ): VerifiedSupabaseUser {
    const metadata = supabaseUser.user_metadata ?? {};

    return {
      supabaseUserId: supabaseUser.id,
      email: supabaseUser.email ?? null,
      emailVerifiedAt: this.supabaseEmailVerifiedAt(supabaseUser),
      firstName:
        this.metadataString(metadata, "first_name") ??
        this.metadataString(metadata, "firstName"),
      lastName:
        this.metadataString(metadata, "last_name") ??
        this.metadataString(metadata, "lastName"),
      displayName:
        this.metadataString(metadata, "display_name") ??
        this.metadataString(metadata, "displayName"),
      healthcareRole:
        this.metadataHealthcareRole(metadata, "healthcare_role") ??
        this.metadataHealthcareRole(metadata, "healthcareRole"),
      profilePhotoUrl:
        this.metadataString(metadata, "avatar_url") ??
        this.metadataString(metadata, "picture"),
      roles: this.metadataSelectableRoles(metadata)
    };
  }

  private metadataString(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private metadataSelectableRoles(metadata: Record<string, unknown>) {
    const userType =
      this.metadataString(metadata, "user_type") ??
      this.metadataString(metadata, "userType");

    if (!userType) {
      return [];
    }

    const normalized = userType.toLowerCase();

    if (normalized === UserRole.renter) {
      return [UserRole.renter];
    }

    if (normalized === UserRole.host) {
      return [UserRole.host];
    }

    return [];
  }

  private metadataHealthcareRole(
    metadata: Record<string, unknown>,
    key: string
  ) {
    const value = this.metadataString(metadata, key);

    if (!value) {
      return null;
    }

    const normalized = value.toLowerCase().replaceAll("-", "_");

    if (normalized in HealthcareRole) {
      return HealthcareRole[normalized as keyof typeof HealthcareRole];
    }

    return null;
  }

  private supabaseEmailVerifiedAt(supabaseUser: SupabaseAuthUser) {
    let rawValue: string | null | undefined;

    if (
      Object.prototype.hasOwnProperty.call(
        supabaseUser,
        "email_confirmed_at"
      )
    ) {
      rawValue = supabaseUser.email_confirmed_at;
    } else if (
      Object.prototype.hasOwnProperty.call(supabaseUser, "confirmed_at")
    ) {
      rawValue = supabaseUser.confirmed_at;
    } else {
      return undefined;
    }

    if (!rawValue) {
      return null;
    }

    const parsedDate = new Date(rawValue);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }
}
