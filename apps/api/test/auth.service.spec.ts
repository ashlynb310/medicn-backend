import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { HealthcareRole, UserRole } from "@prisma/client";
import { AuthService } from "../src/auth/auth.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-06-16T00:00:00.000Z");
const emailVerifiedAt = new Date("2026-06-16T01:02:03.000Z");

const internalUser = {
  id: "user_internal_1",
  supabaseUserId: "supabase-user-1",
  email: "alex@example.com",
  emailVerifiedAt: null,
  firstName: "Alex",
  lastName: "Chen",
  displayName: "Alex C",
  healthcareRole: HealthcareRole.medical_student,
  roles: [],
  healthcareAffiliation: null,
  phoneNumber: null,
  bio: null,
  profilePhotoUrl: null,
  profileComplete: false,
  currentVerificationStatus: "not_started",
  disabledAt: null,
  createdAt: now,
  updatedAt: now
};

function createService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn()
    }
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === "NEXT_PUBLIC_SUPABASE_URL") {
        return "https://project.supabase.co";
      }

      if (key === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") {
        return "sb_publishable_test";
      }

      return undefined;
    })
  };
  const supabase = {
    auth: {
      getUser: jest.fn()
    }
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService
  );

  (
    service as unknown as {
      supabase: typeof supabase;
    }
  ).supabase = supabase;

  return { service, prisma, supabase };
}

describe("AuthService", () => {
  it("extracts a bearer token from the Authorization header", () => {
    const { service } = createService();

    expect(service.extractBearerToken("Bearer access-token")).toBe(
      "access-token"
    );
  });

  it("rejects missing bearer tokens", () => {
    const { service } = createService();

    expect(() => service.extractBearerToken()).toThrow(UnauthorizedException);
  });

  it("rejects invalid Supabase access tokens", async () => {
    const { service, supabase } = createService();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid token")
    });

    await expect(service.verifyAccessToken("bad-token")).rejects.toMatchObject({
      response: {
        code: "INVALID_SUPABASE_TOKEN"
      }
    });
  });

  it("returns USER_NOT_SYNCED when the Supabase user has no internal profile", async () => {
    const { service, prisma, supabase } = createService();
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          email: "alex@example.com",
          user_metadata: {}
        }
      },
      error: null
    });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getCurrentUser("token")).rejects.toMatchObject({
      response: {
        code: "USER_NOT_SYNCED"
      }
    });
    await expect(service.getCurrentUser("token")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("syncs signup profile metadata and selectable user type", async () => {
    const { service, prisma, supabase } = createService();
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          email: "alex@example.com",
          email_confirmed_at: emailVerifiedAt.toISOString(),
          user_metadata: {
            first_name: "Alex",
            last_name: "Chen",
            display_name: "Alex C",
            healthcare_role: "medical_student",
            user_type: "renter"
          }
        }
      },
      error: null
    });
    prisma.user.upsert.mockResolvedValue({
      ...internalUser,
      emailVerifiedAt,
      roles: [UserRole.renter],
      profileComplete: true
    });

    await expect(service.syncCurrentUser("token")).resolves.toMatchObject({
      id: "user_internal_1",
      supabaseUserId: "supabase-user-1",
      email: "alex@example.com",
      emailVerified: true,
      emailVerifiedAt: emailVerifiedAt.toISOString(),
      displayName: "Alex C",
      healthcareRole: "medical_student",
      roles: ["renter"],
      profileComplete: true
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { supabaseUserId: "supabase-user-1" },
      update: {
        email: "alex@example.com",
        emailVerifiedAt,
        firstName: "Alex",
        lastName: "Chen",
        displayName: "Alex C",
        healthcareRole: HealthcareRole.medical_student
      },
      create: {
        supabaseUserId: "supabase-user-1",
        email: "alex@example.com",
        emailVerifiedAt,
        firstName: "Alex",
        lastName: "Chen",
        displayName: "Alex C",
        healthcareRole: HealthcareRole.medical_student,
        profilePhotoUrl: null,
        roles: [UserRole.renter],
        profileComplete: true
      }
    });
  });

  it("ignores unselectable user types from Supabase metadata", async () => {
    const { service, prisma, supabase } = createService();
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          email: "alex@example.com",
          email_confirmed_at: null,
          user_metadata: {
            user_type: "admin"
          }
        }
      },
      error: null
    });
    prisma.user.upsert.mockResolvedValue({
      ...internalUser,
      firstName: null,
      lastName: null,
      displayName: null,
      healthcareRole: null
    });

    await expect(service.syncCurrentUser("token")).resolves.toMatchObject({
      id: "user_internal_1",
      roles: [],
      profileComplete: false
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { supabaseUserId: "supabase-user-1" },
      update: {
        email: "alex@example.com",
        emailVerifiedAt: null
      },
      create: {
        supabaseUserId: "supabase-user-1",
        email: "alex@example.com",
        emailVerifiedAt: null,
        firstName: null,
        lastName: null,
        displayName: null,
        healthcareRole: null,
        profilePhotoUrl: null,
        roles: [],
        profileComplete: false
      }
    });
  });

  it("maps host signup metadata to the internal host role", async () => {
    const { service, prisma, supabase } = createService();
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          email: "host@example.com",
          email_confirmed_at: emailVerifiedAt.toISOString(),
          user_metadata: {
            user_type: "host"
          }
        }
      },
      error: null
    });
    prisma.user.upsert.mockResolvedValue({
      ...internalUser,
      email: "host@example.com",
      emailVerifiedAt,
      roles: [UserRole.host],
      profileComplete: true
    });

    await expect(service.syncCurrentUser("token")).resolves.toMatchObject({
      email: "host@example.com",
      roles: ["host"],
      profileComplete: true
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          roles: [UserRole.host],
          profileComplete: true
        })
      })
    );
  });
});
