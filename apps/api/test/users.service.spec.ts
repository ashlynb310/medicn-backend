import type { AuthService } from "../src/auth/auth.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";

const now = new Date("2026-06-16T00:00:00.000Z");

const internalUser = {
  id: "user_internal_1",
  supabaseUserId: "supabase-user-1",
  email: "alex@example.com",
  emailVerifiedAt: null,
  firstName: "Alex",
  lastName: "Chen",
  displayName: null,
  healthcareRole: null,
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

type TestUser = Omit<typeof internalUser, "emailVerifiedAt"> & {
  emailVerifiedAt: Date | null;
};

function createService() {
  const prisma = {
    user: {
      update: jest.fn()
    }
  };
  const authService = {
    getCurrentUserRecord: jest.fn(),
    toCurrentUserDto: jest.fn((user: TestUser) => ({
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
      roles: user.roles,
      profileComplete: user.profileComplete,
      currentVerificationStatus: user.currentVerificationStatus
    }))
  };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    authService as unknown as AuthService
  );

  return { service, prisma, authService };
}

describe("UsersService", () => {
  it("updates the current user's editable profile fields", async () => {
    const { service, prisma, authService } = createService();
    const updatedUser = {
      ...internalUser,
      firstName: "Maya",
      displayName: "Maya C",
      healthcareRole: "nurse",
      healthcareAffiliation: "Houston Methodist",
      phoneNumber: null,
      bio: "Travel nurse looking for short-term housing."
    };
    authService.getCurrentUserRecord.mockResolvedValue(internalUser);
    prisma.user.update.mockResolvedValue(updatedUser);

    await expect(
      service.updateCurrentUser("token", {
        firstName: "  Maya  ",
        displayName: "  Maya C  ",
        healthcareRole: "nurse",
        healthcareAffiliation: "Houston Methodist",
        phoneNumber: "",
        bio: "Travel nurse looking for short-term housing."
      })
    ).resolves.toMatchObject({
      firstName: "Maya",
      displayName: "Maya C",
      healthcareRole: "nurse",
      healthcareAffiliation: "Houston Methodist",
      phoneNumber: null,
      bio: "Travel nurse looking for short-term housing."
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_internal_1" },
      data: {
        firstName: "Maya",
        displayName: "Maya C",
        healthcareRole: "nurse",
        healthcareAffiliation: "Houston Methodist",
        phoneNumber: null,
        bio: "Travel nurse looking for short-term housing."
      }
    });
  });

  it("returns the current user without writing when no profile fields are provided", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(internalUser);

    await expect(service.updateCurrentUser("token", {})).resolves.toMatchObject({
      id: "user_internal_1",
      supabaseUserId: "supabase-user-1"
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
