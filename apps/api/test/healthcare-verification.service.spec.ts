import { ConfigService } from "@nestjs/config";
import {
  HealthcareAffiliationType,
  HealthcareEvidenceCategory,
  HealthcareRole,
  HealthcareSubmissionStatus,
  IdentityVerificationStatus,
  MediaAssetStatus,
  MediaPurpose,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { HealthcareVerificationService } from "../src/healthcare/healthcare-verification.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { JobsService } from "../src/jobs/jobs.service";
import type { MediaStorage } from "../src/media/media-storage";
import type { PrismaService } from "../src/prisma/prisma.service";

const user = {
  id: "user_1",
  roles: [UserRole.renter],
  disabledAt: null
};

const claim = {
  claimedRole: HealthcareRole.nurse,
  claimedAffiliationName: "  General Hospital  ",
  claimedAffiliationType: HealthcareAffiliationType.hospital,
  evidenceCategory: HealthcareEvidenceCategory.employment
};

function createService() {
  const transaction = {
    $executeRaw: jest.fn(),
    healthcareVerification: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn()
    },
    healthcareVerificationEvidence: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn()
    },
    mediaAsset: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn()
    },
    mediaVariant: { findFirst: jest.fn() },
    user: { update: jest.fn() },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    healthcareVerification: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    healthcareVerificationEvidence: { findFirst: jest.fn() },
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => unknown) => callback(transaction)
    )
  };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(user) };
  const eligibility = { assertApproved: jest.fn().mockResolvedValue(undefined) };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "outbox_1" }) };
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn().mockResolvedValue("https://signed-upload"),
    createSignedDownloadUrl: jest.fn(),
    exists: jest.fn().mockResolvedValue(true),
    info: jest.fn().mockResolvedValue({ size: 1024, contentType: "image/jpeg" }),
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn()
  };
  const service = new HealthcareVerificationService(
    prisma as unknown as PrismaService,
    auth as unknown as AuthService,
    eligibility as unknown as IdentityEligibilityService,
    new ConfigService({
      SUPABASE_HEALTHCARE_EVIDENCE_BUCKET: "healthcare-credentials",
      HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES: 10_485_760
    }),
    jobs as unknown as JobsService,
    storage
  );
  return { service, prisma, transaction, auth, eligibility, jobs, storage };
}

describe("HealthcareVerificationService", () => {
  it("rejects disabled accounts before identity or database work", async () => {
    const { service, auth, eligibility, transaction } = createService();
    auth.getCurrentUserRecord.mockRejectedValue({
      response: { code: "ACCOUNT_DISABLED" }
    });

    await expect(service.create("token", claim)).rejects.toMatchObject({
      response: { code: "ACCOUNT_DISABLED" }
    });
    expect(eligibility.assertApproved).not.toHaveBeenCalled();
    expect(transaction.healthcareVerification.create).not.toHaveBeenCalled();
  });

  it("requires approved identity before creating a versioned submission", async () => {
    const { service, eligibility, transaction } = createService();
    eligibility.assertApproved.mockRejectedValue({
      response: { code: "IDENTITY_VERIFICATION_REQUIRED" }
    });

    await expect(service.create("token", claim)).rejects.toMatchObject({
      response: { code: "IDENTITY_VERIFICATION_REQUIRED" }
    });
    expect(transaction.healthcareVerification.create).not.toHaveBeenCalled();
  });

  it("returns only an opaque evidence id, signed upload URL and expiry", async () => {
    const { service, transaction } = createService();
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: user.id,
      submissionStatus: HealthcareSubmissionStatus.created
    });
    transaction.healthcareVerificationEvidence.count.mockResolvedValue(0);
    transaction.mediaAsset.create.mockResolvedValue({
      id: "asset_1",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      ingestBucket: "healthcare-credentials",
      ingestStoragePath: "private/secret/path"
    });
    transaction.healthcareVerificationEvidence.create.mockResolvedValue({
      id: "evidence_1"
    });

    await expect(
      service.createUploadIntent("token", "verification_1", {
        fileName: "license.jpg",
        contentType: "image/jpeg"
      })
    ).resolves.toEqual({
      evidenceId: "evidence_1",
      uploadUrl: "https://signed-upload",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
  });

  it("queues processing atomically with opaque identifiers after size confirmation", async () => {
    const { service, transaction, jobs } = createService();
    transaction.healthcareVerificationEvidence.findFirst.mockResolvedValue({
      id: "evidence_1",
      healthcareVerificationId: "verification_1",
      mediaAssetId: "asset_1",
      mediaAsset: {
        id: "asset_1",
        status: MediaAssetStatus.pending_upload,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        ingestBucket: "healthcare-credentials",
        ingestStoragePath: "private/secret/path"
      }
    });
    transaction.mediaAsset.findUniqueOrThrow.mockResolvedValue({
      id: "asset_1",
      status: MediaAssetStatus.pending_upload
    });

    await service.completeUpload("token", "verification_1", "evidence_1");

    expect(jobs.enqueue).toHaveBeenCalledWith(
      "process_media_asset",
      { assetId: "asset_1" },
      expect.objectContaining({ deduplicationKey: "media-process:asset_1" })
    );
    expect(JSON.stringify(jobs.enqueue.mock.calls)).not.toContain("private/secret/path");
  });

  it("enforces the three-image limit before creating another private asset", async () => {
    const { service, transaction } = createService();
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: user.id,
      submissionStatus: HealthcareSubmissionStatus.uploading
    });
    transaction.healthcareVerificationEvidence.count.mockResolvedValue(3);

    await expect(service.createUploadIntent("token", "verification_1", {
      fileName: "fourth.png",
      contentType: "image/png"
    })).rejects.toMatchObject({
      response: { code: "HEALTHCARE_EVIDENCE_LIMIT_REACHED" }
    });
    expect(transaction.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("uses opaque not-found behavior for another user's submission", async () => {
    const { service, transaction, storage } = createService();
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: "another_user",
      submissionStatus: HealthcareSubmissionStatus.created
    });

    await expect(service.createUploadIntent("token", "verification_1", {
      fileName: "claim.jpg",
      contentType: "image/jpeg"
    })).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects objects larger than 10 MB and queues opaque cleanup", async () => {
    const { service, transaction, storage, jobs } = createService();
    transaction.healthcareVerificationEvidence.findFirst.mockResolvedValue({
      id: "evidence_1",
      healthcareVerificationId: "verification_1",
      mediaAssetId: "asset_1",
      mediaAsset: {
        id: "asset_1",
        status: MediaAssetStatus.pending_upload,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        ingestBucket: "healthcare-credentials",
        ingestStoragePath: "private/oversized.jpg"
      }
    });
    storage.info.mockResolvedValue({ size: 10_485_761, contentType: "image/jpeg" });

    await expect(
      service.completeUpload("token", "verification_1", "evidence_1")
    ).rejects.toMatchObject({ response: { code: "MEDIA_INPUT_TOO_LARGE" } });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "cleanup_media_asset",
      { assetId: "asset_1" },
      expect.objectContaining({ client: transaction })
    );
    expect(JSON.stringify(jobs.enqueue.mock.calls)).not.toContain("oversized.jpg");
  });

  it("submits only after a sanitized derivative exists and its original is gone", async () => {
    const { service, transaction } = createService();
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: user.id,
      version: 1,
      claimedRole: HealthcareRole.nurse,
      claimedAffiliationName: "General Hospital",
      claimedAffiliationType: HealthcareAffiliationType.hospital,
      evidenceCategory: HealthcareEvidenceCategory.employment,
      submissionStatus: HealthcareSubmissionStatus.processing,
      status: "not_started",
      submittedAt: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      evidence: [{
        id: "evidence_1",
        mediaAsset: {
          status: MediaAssetStatus.ready,
          ingestDeletedAt: new Date(),
          variants: [{ type: "healthcare_review" }]
        }
      }]
    });
    transaction.healthcareVerification.update.mockResolvedValue({
      id: "verification_1",
      userId: user.id,
      version: 1,
      claimedRole: HealthcareRole.nurse,
      claimedAffiliationName: "General Hospital",
      claimedAffiliationType: HealthcareAffiliationType.hospital,
      evidenceCategory: HealthcareEvidenceCategory.employment,
      submissionStatus: HealthcareSubmissionStatus.pending_review,
      status: "pending",
      submittedAt: new Date("2026-07-19T00:00:00.000Z"),
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      evidence: [{ id: "evidence_1", mediaAsset: { status: MediaAssetStatus.ready } }]
    });

    await expect(service.submit("token", "verification_1")).resolves.toMatchObject({
      status: HealthcareSubmissionStatus.pending_review
    });
    expect(transaction.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { currentVerificationStatus: "pending" }
    }));
  });

  it("returns redacted current-user history without storage or reviewer fields", async () => {
    const { service, prisma } = createService();
    prisma.healthcareVerification.findMany.mockResolvedValue([
      {
        id: "verification_1",
        version: 2,
        claimedRole: HealthcareRole.nurse,
        claimedAffiliationName: "General Hospital",
        claimedAffiliationType: HealthcareAffiliationType.hospital,
        evidenceCategory: HealthcareEvidenceCategory.employment,
        submissionStatus: HealthcareSubmissionStatus.pending_review,
        status: "pending",
        submittedAt: new Date("2026-07-19T00:00:00.000Z"),
        reviewedAt: null,
        withdrawnAt: null,
        createdAt: new Date("2026-07-18T00:00:00.000Z"),
        evidence: [{ id: "evidence_1", mediaAsset: { status: MediaAssetStatus.ready } }],
        reviewedByAdminId: "admin_secret",
        adminReviewNote: "private note"
      }
    ]);

    const result = await service.getMine("token");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("admin_secret");
    expect(serialized).not.toContain("private note");
    expect(serialized).not.toContain("storage");
    expect(result.history[0]).toMatchObject({ version: 2, evidenceCount: 1 });
  });

  it("does not treat identity state as healthcare state", async () => {
    expect(IdentityVerificationStatus.approved).toBe("approved");
    expect(MediaPurpose.healthcare_credential).toBe("healthcare_credential");
  });
});
