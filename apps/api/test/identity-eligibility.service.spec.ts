import { IdentityVerificationStatus } from "@prisma/client";
import { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { PrismaService } from "../src/prisma/prisma.service";

describe("IdentityEligibilityService", () => {
  it.each([
    [null, "IDENTITY_VERIFICATION_REQUIRED"],
    [IdentityVerificationStatus.created, "IDENTITY_VERIFICATION_PENDING"],
    [IdentityVerificationStatus.review, "IDENTITY_VERIFICATION_PENDING"],
    [IdentityVerificationStatus.declined, "IDENTITY_VERIFICATION_REJECTED"],
    [IdentityVerificationStatus.abandoned, "IDENTITY_VERIFICATION_REJECTED"],
    [IdentityVerificationStatus.expired, "IDENTITY_VERIFICATION_EXPIRED"]
  ])("maps %s to %s", async (status, code) => {
    const prisma = {
      identityVerification: {
        findFirst: jest.fn().mockResolvedValue(status ? { status } : null)
      }
    };
    const service = new IdentityEligibilityService(
      prisma as unknown as PrismaService
    );
    await expect(service.assertApproved("user-1")).rejects.toMatchObject({
      response: { code }
    });
  });

  it("allows only a current approved identity record", async () => {
    const prisma = {
      identityVerification: {
        findFirst: jest.fn().mockResolvedValue({
          status: IdentityVerificationStatus.approved
        })
      }
    };
    const service = new IdentityEligibilityService(
      prisma as unknown as PrismaService
    );
    await expect(service.assertApproved("user-1")).resolves.toBeUndefined();
  });
});
