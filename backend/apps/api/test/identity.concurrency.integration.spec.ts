import {
  HealthcareSubmissionStatus,
  IdentityVerificationStatus,
  VerificationStatus
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { EmailService } from "../src/email/email.service";
import { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import { IdentityService } from "../src/identity/identity.service";
import type { VeriffIdentityProvider } from "../src/identity/veriff.provider";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("IdentityService PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}`;
  let prisma: PrismaService | undefined;
  let userId: string | undefined;
  let service: IdentityService;
  const createSession = jest.fn();

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
      throw new Error(
        "RUN_DATABASE_INTEGRATION_TESTS requires a PostgreSQL DATABASE_URL."
      );
    }

    prisma = new PrismaService();
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        supabaseUserId: `identity-integration-${suffix}`,
        email: `identity-integration-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: ["renter"]
      }
    });
    userId = user.id;
    await prisma.healthcareVerification.create({
      data: {
        userId,
        status: VerificationStatus.approved,
        submissionStatus: HealthcareSubmissionStatus.evidence_deleted,
        legacyRecord: true
      }
    });

    createSession.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        providerSessionId: `veriff-session-${suffix}`,
        hostedUrl: `https://magic.veriff.me/${suffix}`,
        providerStatus: "created",
        expiresAt: null
      };
    });
    const provider = {
      callbackUrl: jest.fn().mockReturnValue("https://api.example.com/callback"),
      createSession,
      verifyAndNormalizeWebhook: jest.fn()
    };
    service = new IdentityService(
      prisma,
      {
        getCurrentUserRecord: jest.fn().mockResolvedValue(user)
      } as unknown as AuthService,
      provider as unknown as VeriffIdentityProvider,
      { queueTransactionalEmail: jest.fn() } as unknown as EmailService
    );
  });

  afterAll(async () => {
    if (prisma && userId) {
      await prisma.identityWebhookEvent.deleteMany({
        where: { identityVerification: { userId } }
      });
      await prisma.identityVerification.updateMany({
        where: { userId },
        data: { supersededById: null }
      });
      await prisma.identityVerification.deleteMany({ where: { userId } });
      await prisma.healthcareVerification.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma?.$disconnect();
  });

  it("serializes concurrent calls into one active provider session", async () => {
    const results = await Promise.all([
      service.createOrReuseSession("token"),
      service.createOrReuseSession("token")
    ]);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    await expect(
      prisma!.identityVerification.count({
        where: { userId, supersededAt: null }
      })
    ).resolves.toBe(1);
  });

  it("keeps approved healthcare credential state separate from identity", async () => {
    const healthcare = await prisma!.healthcareVerification.findFirstOrThrow({
      where: { userId }
    });
    const identity = await prisma!.identityVerification.findFirstOrThrow({
      where: { userId, supersededAt: null }
    });
    expect(healthcare.status).toBe(VerificationStatus.approved);
    expect(identity.status).toBe(IdentityVerificationStatus.created);
    await expect(
      new IdentityEligibilityService(prisma!).assertApproved(userId!)
    ).rejects.toMatchObject({
      response: { code: "IDENTITY_VERIFICATION_PENDING" }
    });
  });
});
