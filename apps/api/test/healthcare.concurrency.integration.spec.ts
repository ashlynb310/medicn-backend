import { ConfigService } from "@nestjs/config";
import {
  HealthcareAffiliationType,
  HealthcareDecisionReasonCode,
  HealthcareEvidenceCategory,
  HealthcareRole,
  HealthcareSubmissionStatus,
  IdentityVerificationStatus,
  MediaAssetStatus,
  MediaPurpose,
  MediaVariantType,
  UserRole,
  VerificationStatus,
  type User
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { HealthcareAdminService } from "../src/healthcare/healthcare-admin.service";
import { HealthcareVerificationService } from "../src/healthcare/healthcare-verification.service";
import { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import { JobsService } from "../src/jobs/jobs.service";
import type { MediaStorage } from "../src/media/media-storage";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("Healthcare verification PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}`;
  const config = new ConfigService({
    SUPABASE_HEALTHCARE_EVIDENCE_BUCKET: "healthcare-credentials",
    HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES: 10_485_760,
    HEALTHCARE_EVIDENCE_VIEW_URL_TTL_SECONDS: 60
  });
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    info: jest.fn(),
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn()
  };
  const claim = {
    claimedRole: HealthcareRole.nurse,
    claimedAffiliationName: "Concurrency Hospital",
    claimedAffiliationType: HealthcareAffiliationType.hospital,
    evidenceCategory: HealthcareEvidenceCategory.employment
  };
  let prisma: PrismaService;
  let subject: User;
  let admin: User;
  let actor: User;
  let healthcare: HealthcareVerificationService;
  let adminService: HealthcareAdminService;
  let firstId = "";
  let secondId = "";
  let mediaAssetId = "";

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    subject = await prisma.user.create({
      data: {
        supabaseUserId: `healthcare-subject-${suffix}`,
        email: `healthcare-subject-${suffix}@example.com`,
        roles: [UserRole.renter]
      }
    });
    admin = await prisma.user.create({
      data: {
        supabaseUserId: `healthcare-admin-${suffix}`,
        email: `healthcare-admin-${suffix}@example.com`,
        roles: [UserRole.admin]
      }
    });
    await prisma.identityVerification.create({
      data: {
        userId: subject.id,
        providerSessionId: `healthcare-session-${suffix}`,
        vendorData: `healthcare-vendor-${suffix}`,
        status: IdentityVerificationStatus.approved,
        decidedAt: new Date()
      }
    });
    actor = subject;
    const auth = { getCurrentUserRecord: jest.fn(async () => actor) };
    const jobs = new JobsService(prisma);
    healthcare = new HealthcareVerificationService(
      prisma,
      auth as unknown as AuthService,
      new IdentityEligibilityService(prisma),
      config,
      jobs,
      storage
    );
    adminService = new HealthcareAdminService(
      prisma,
      auth as unknown as AuthService,
      config,
      jobs,
      storage
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    const verificationIds = await prisma.healthcareVerification.findMany({
      where: { userId: subject?.id },
      select: { id: true }
    });
    const ids = verificationIds.map(({ id }) => id);
    await prisma.adminAction.deleteMany({ where: { targetId: { in: ids } } });
    const evidenceIds = await prisma.healthcareVerificationEvidence.findMany({
      where: { healthcareVerificationId: { in: ids } },
      select: { id: true, mediaAssetId: true }
    });
    await prisma.adminAction.deleteMany({
      where: { targetId: { in: evidenceIds.map(({ id }) => id) } }
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...ids, ...evidenceIds.map(({ mediaAssetId }) => mediaAssetId)] } }
    });
    await prisma.mediaVariant.deleteMany({
      where: { mediaAssetId: { in: evidenceIds.map(({ mediaAssetId }) => mediaAssetId) } }
    });
    await prisma.healthcareVerificationEvidence.deleteMany({
      where: { healthcareVerificationId: { in: ids } }
    });
    await prisma.mediaAsset.deleteMany({
      where: { id: { in: evidenceIds.map(({ mediaAssetId }) => mediaAssetId) } }
    });
    await prisma.healthcareVerification.deleteMany({ where: { id: { in: ids } } });
    await prisma.identityVerification.deleteMany({ where: { userId: subject?.id } });
    await prisma.user.deleteMany({ where: { id: { in: [subject?.id, admin?.id].filter(Boolean) as string[] } } });
    await prisma.$disconnect();
  });

  it("allows one active submission under concurrency and preserves version history", async () => {
    actor = subject;
    const results = await Promise.allSettled([
      healthcare.create("subject-token", claim),
      healthcare.create("subject-token", claim)
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const first = await prisma.healthcareVerification.findFirstOrThrow({
      where: { userId: subject.id }
    });
    firstId = first.id;
    await expect(prisma.healthcareVerification.count({
      where: {
        userId: subject.id,
        submissionStatus: {
          in: [
            HealthcareSubmissionStatus.created,
            HealthcareSubmissionStatus.uploading,
            HealthcareSubmissionStatus.processing,
            HealthcareSubmissionStatus.pending_review
          ]
        }
      }
    })).resolves.toBe(1);

    await prisma.healthcareVerification.update({
      where: { id: first.id },
      data: {
        submissionStatus: HealthcareSubmissionStatus.evidence_deleted,
        status: VerificationStatus.rejected,
        reviewedAt: new Date()
      }
    });
    const second = await healthcare.create("subject-token", {
      ...claim,
      claimedAffiliationName: "Version Two Hospital"
    });
    secondId = second.id;
    const history = await prisma.healthcareVerification.findMany({
      where: { userId: subject.id },
      orderBy: { version: "asc" },
      select: { id: true, version: true, claimedAffiliationName: true }
    });
    expect(history).toEqual([
      { id: firstId, version: 1, claimedAffiliationName: "Concurrency Hospital" },
      { id: secondId, version: 2, claimedAffiliationName: "Version Two Hospital" }
    ]);
  });

  it("allows one concurrent Admin decision and atomically queues opaque deletion", async () => {
    mediaAssetId = `healthcare-asset-${suffix}`;
    const evidenceId = `healthcare-evidence-${suffix}`;
    await prisma.mediaAsset.create({
      data: {
        id: mediaAssetId,
        purpose: MediaPurpose.healthcare_credential,
        ownerUserId: subject.id,
        ingestBucket: "healthcare-credentials",
        ingestStoragePath: `healthcare-evidence/${subject.id}/${secondId}/${evidenceId}/original/${mediaAssetId}/claim.jpg`,
        claimedFileName: "claim.jpg",
        claimedContentType: "image/jpeg",
        status: MediaAssetStatus.ready,
        expiresAt: new Date(Date.now() + 60_000),
        uploadedAt: new Date(),
        processedAt: new Date(),
        ingestDeletedAt: new Date(),
        variants: {
          create: {
            type: MediaVariantType.healthcare_review,
            storageBucket: "healthcare-credentials",
            storagePath: `healthcare-evidence/${subject.id}/${secondId}/${evidenceId}/review/${mediaAssetId}.webp`,
            width: 1200,
            height: 800,
            byteSize: 1000,
            contentType: "image/webp",
            checksumSha256: "a".repeat(64)
          }
        }
      }
    });
    await prisma.healthcareVerificationEvidence.create({
      data: {
        id: evidenceId,
        healthcareVerificationId: secondId,
        mediaAssetId,
        sanitizedAt: new Date()
      }
    });
    await prisma.healthcareVerification.update({
      where: { id: secondId },
      data: {
        submissionStatus: HealthcareSubmissionStatus.pending_review,
        status: VerificationStatus.pending,
        submittedAt: new Date()
      }
    });
    actor = admin;

    const decisions = await Promise.allSettled([
      adminService.decide("admin-token", secondId, {
        status: "approved",
        reasonCode: HealthcareDecisionReasonCode.information_confirmed
      }),
      adminService.decide("admin-token", secondId, {
        status: "rejected",
        reasonCode: HealthcareDecisionReasonCode.information_mismatch
      })
    ]);
    expect(decisions.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(decisions.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const decided = await prisma.healthcareVerification.findUniqueOrThrow({
      where: { id: secondId }
    });
    expect(decided.submissionStatus).toBe(HealthcareSubmissionStatus.deletion_pending);
    expect(decided.reviewedByAdminId).toBe(admin.id);
    expect(decided.reviewedAt).not.toBeNull();
    const outbox = await prisma.outboxEvent.findMany({
      where: { aggregateId: secondId }
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toEqual({ healthcareVerificationId: secondId });
    const serialized = JSON.stringify(outbox[0]?.payload);
    expect(serialized).not.toContain("healthcare-credentials");
    expect(serialized).not.toContain("claim.jpg");
    const actions = await prisma.adminAction.findMany({
      where: { targetId: secondId }
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.note).not.toContain("claim.jpg");
    await expect(prisma.identityVerification.findFirst({
      where: { userId: subject.id },
      select: { status: true }
    })).resolves.toEqual({ status: IdentityVerificationStatus.approved });
  });
});
