import { ConfigService } from "@nestjs/config";
import {
  HealthcareDecisionReasonCode,
  HealthcareSubmissionStatus,
  MediaAssetStatus,
  MediaVariantType,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { HealthcareAdminService } from "../src/healthcare/healthcare-admin.service";
import type { JobsService } from "../src/jobs/jobs.service";
import type { MediaStorage } from "../src/media/media-storage";
import type { PrismaService } from "../src/prisma/prisma.service";

const admin = { id: "admin_1", roles: [UserRole.admin] };

function createService() {
  const transaction = {
    $queryRaw: jest.fn(),
    healthcareVerification: { findUnique: jest.fn(), update: jest.fn() },
    healthcareVerificationEvidence: { update: jest.fn(), updateMany: jest.fn() },
    user: { update: jest.fn() },
    adminAction: { create: jest.fn() },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    healthcareVerification: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    healthcareVerificationEvidence: { findFirst: jest.fn() },
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => unknown) => callback(transaction)
    )
  };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(admin) };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "outbox_1" }) };
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn().mockResolvedValue("https://private-signed-url"),
    exists: jest.fn(),
    info: jest.fn(),
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn()
  };
  const service = new HealthcareAdminService(
    prisma as unknown as PrismaService,
    auth as unknown as AuthService,
    new ConfigService({ HEALTHCARE_EVIDENCE_VIEW_URL_TTL_SECONDS: 60 }),
    jobs as unknown as JobsService,
    storage
  );
  return { service, prisma, transaction, auth, jobs, storage };
}

describe("HealthcareAdminService", () => {
  it("defaults the Admin queue to pending review and returns bounded summaries", async () => {
    const { service, prisma } = createService();
    prisma.healthcareVerification.count.mockResolvedValue(1);
    prisma.healthcareVerification.findMany.mockResolvedValue([{
      id: "verification_1",
      userId: "user_1",
      version: 1,
      claimedRole: "nurse",
      claimedAffiliationName: "General Hospital",
      claimedAffiliationType: "hospital",
      evidenceCategory: "employment",
      submissionStatus: HealthcareSubmissionStatus.pending_review,
      submittedAt: new Date("2026-07-19T00:00:00.000Z"),
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      adminReviewNote: "must not appear",
      evidence: [{
        id: "evidence_1",
        sanitizedAt: new Date("2026-07-19T00:00:00.000Z"),
        mediaAsset: {
          status: MediaAssetStatus.ready,
          ingestStoragePath: "must/not/appear"
        }
      }]
    }]);

    const result = await service.list("token", {});

    expect(prisma.healthcareVerification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submissionStatus: HealthcareSubmissionStatus.pending_review
        })
      })
    );
    expect(JSON.stringify(result)).not.toContain("must not appear");
    expect(JSON.stringify(result)).not.toContain("must/not/appear");
  });

  it("rejects non-Admin access before querying private evidence", async () => {
    const { service, auth, prisma, storage } = createService();
    auth.getCurrentUserRecord.mockResolvedValue({ id: "user_1", roles: [UserRole.renter] });

    await expect(service.viewEvidence("token", "verification_1", "evidence_1"))
      .rejects.toMatchObject({ response: { code: "FORBIDDEN" } });
    expect(prisma.healthcareVerificationEvidence.findFirst).not.toHaveBeenCalled();
    expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("creates an audited URL of no more than 60 seconds without persisting it", async () => {
    const { service, prisma, transaction, storage } = createService();
    prisma.healthcareVerificationEvidence.findFirst.mockResolvedValue({
      id: "evidence_1",
      healthcareVerificationId: "verification_1",
      mediaAsset: {
        status: MediaAssetStatus.ready,
        variants: [{
          type: MediaVariantType.healthcare_review,
          storageBucket: "healthcare-credentials",
          storagePath: "private/review.webp"
        }]
      }
    });

    const result = await service.viewEvidence("token", "verification_1", "evidence_1");

    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith(
      "healthcare-credentials",
      "private/review.webp",
      60
    );
    expect(result).toMatchObject({ evidenceId: "evidence_1", viewUrl: "https://private-signed-url" });
    expect(transaction.adminAction.create).toHaveBeenCalled();
    expect(JSON.stringify(transaction.adminAction.create.mock.calls)).not.toContain("private/review.webp");
    expect(JSON.stringify(transaction.adminAction.create.mock.calls)).not.toContain("private-signed-url");
  });

  it("decides and queues deletion atomically with a redacted audit record", async () => {
    const { service, transaction, jobs } = createService();
    transaction.$queryRaw.mockResolvedValue([{ id: "verification_1" }]);
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: "user_1",
      submissionStatus: HealthcareSubmissionStatus.pending_review,
      evidence: [{ id: "evidence_1", mediaAsset: { status: MediaAssetStatus.ready } }]
    });
    transaction.healthcareVerification.update.mockResolvedValue({
      id: "verification_1",
      submissionStatus: HealthcareSubmissionStatus.deletion_pending,
      status: "approved"
    });

    await service.decide("token", "verification_1", {
      status: "approved",
      reasonCode: HealthcareDecisionReasonCode.information_confirmed,
      note: "private reviewer note"
    });

    expect(jobs.enqueue).toHaveBeenCalledWith(
      "delete_healthcare_verification_evidence",
      { healthcareVerificationId: "verification_1" },
      expect.objectContaining({ client: transaction })
    );
    const audit = JSON.stringify(transaction.adminAction.create.mock.calls);
    expect(audit).toContain("information_confirmed");
    expect(audit).not.toContain("private reviewer note");
  });
});
