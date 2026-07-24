import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  HealthcareRole,
  IdentityVerificationStatus,
  UserRole,
  VerificationStatus,
  type User
} from "@prisma/client";
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
  profilePhoto: { url: string; source: "processed" | "legacy" } | null;
  roles: Array<"renter" | "host" | "admin">;
  profileComplete: boolean;
  /** @deprecated Healthcare-verification status only; use healthcareVerification.status. */
  currentVerificationStatus:
    | "not_started"
    | "pending"
    | "approved"
    | "rejected"
    | "expired";
  healthcareVerification: {
    status:
      | "not_started"
      | "pending"
      | "approved"
      | "rejected"
      | "expired";
  };
  identityVerification: {
    status:
      | "not_started"
      | "created"
      | "submitted"
      | "review"
      | "resubmission_requested"
      | "approved"
      | "declined"
      | "expired"
      | "abandoned";
    provider: "veriff";
    submittedAt: string | null;
    decidedAt: string | null;
    expiresAt: string | null;
    canRetry: boolean;
    actionRequired: "start" | "continue" | "wait" | "resubmit" | "none" | "retry";
  };
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

    this.assertAccountEnabled(user);

    return user;
  }

  async getCurrentUser(token: string) {
    return this.toCurrentUserDto(await this.getCurrentUserRecord(token));
  }

  getAccessTokenExpiry(token: string) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || !parts[1]) throw new Error("invalid jwt");
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      ) as { exp?: unknown };
      if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
        throw new Error("missing exp");
      }
      const expiresAt = Math.floor(payload.exp);
      if (expiresAt * 1_000 <= Date.now()) throw new Error("expired jwt");
      return expiresAt;
    } catch {
      throw new UnauthorizedException({
        code: "INVALID_SUPABASE_TOKEN",
        message: "Supabase access token is invalid or expired.",
        details: {}
      });
    }
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

    const existingUser = await this.prisma.user.findUnique({
      where: { supabaseUserId: supabaseUser.supabaseUserId }
    });
    if (existingUser) {
      this.assertAccountEnabled(existingUser);
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
        profilePhotoUrl: null,
        roles: supabaseUser.roles,
        profileComplete: supabaseUser.roles.length > 0
      }
    });

    this.assertAccountEnabled(user);

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
      // Provider avatar metadata is untrusted product media. Existing stored
      // URLs remain explicit legacy data, but new values enter via MediaAsset.
    };
  }

  async toCurrentUserDto(user: User): Promise<CurrentUserDto> {
    const [identity, healthcare] = await Promise.all([
      this.prisma.identityVerification.findFirst({
        where: { userId: user.id, supersededAt: null },
        select: {
          status: true,
          submittedAt: true,
          decidedAt: true,
          expiresAt: true
        }
      }),
      this.prisma.healthcareVerification.findFirst({
        where: { userId: user.id, legacyIdentitySource: false },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { status: true }
      })
    ]);
    const identityStatus =
      identity?.status ?? IdentityVerificationStatus.not_started;
    const healthcareStatus =
      healthcare?.status ?? VerificationStatus.not_started;
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
      profilePhoto: user.profilePhotoUrl
        ? {
            url: user.profilePhotoUrl,
            source: user.activeProfileMediaAssetId ? "processed" : "legacy"
          }
        : null,
      roles: [...user.roles],
      profileComplete: user.profileComplete,
      // Deprecated compatibility alias. It remains healthcare-only while
      // clients transition to healthcareVerification.status.
      currentVerificationStatus: healthcareStatus,
      healthcareVerification: { status: healthcareStatus },
      identityVerification: {
        status: identityStatus,
        provider: "veriff",
        submittedAt: identity?.submittedAt?.toISOString() ?? null,
        decidedAt: identity?.decidedAt?.toISOString() ?? null,
        expiresAt: identity?.expiresAt?.toISOString() ?? null,
        canRetry:
          identityStatus === IdentityVerificationStatus.not_started ||
          identityStatus === IdentityVerificationStatus.declined ||
          identityStatus === IdentityVerificationStatus.expired ||
          identityStatus === IdentityVerificationStatus.abandoned,
        actionRequired: this.identityAction(identityStatus)
      }
    };
  }

  private assertAccountEnabled(user: Pick<User, "disabledAt">) {
    if (user.disabledAt === null) {
      return;
    }

    throw new ForbiddenException({
      code: "ACCOUNT_DISABLED",
      message: "This MediCN account is disabled.",
      details: {}
    });
  }

  private identityAction(status: IdentityVerificationStatus) {
    if (status === IdentityVerificationStatus.not_started) return "start" as const;
    if (status === IdentityVerificationStatus.created) return "continue" as const;
    if (status === IdentityVerificationStatus.resubmission_requested) return "resubmit" as const;
    if (status === IdentityVerificationStatus.approved) return "none" as const;
    if (
      status === IdentityVerificationStatus.declined ||
      status === IdentityVerificationStatus.expired ||
      status === IdentityVerificationStatus.abandoned
    ) return "retry" as const;
    return "wait" as const;
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
