import { ConfigService } from "@nestjs/config";
import { HealthcareSubmissionStatus, MediaAssetStatus } from "@prisma/client";
import { HealthcareEvidenceDeletionService } from "../src/healthcare/healthcare-evidence-deletion.service";
import type { MediaStorage } from "../src/media/media-storage";
import type { PrismaService } from "../src/prisma/prisma.service";

function createService() {
  const evidence = {
    id: "evidence_1",
    deletionAttempts: 0,
    mediaAsset: {
      id: "asset_1",
      ingestBucket: "healthcare-credentials",
      ingestStoragePath: "private/original.jpg",
      ingestDeletedAt: null,
      variants: [{
        id: "variant_1",
        storageBucket: "healthcare-credentials",
        storagePath: "private/review.webp",
        deletedAt: null
      }]
    }
  };
  const transaction = {
    $executeRaw: jest.fn(),
    healthcareVerification: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    healthcareVerificationEvidence: {
      updateMany: jest.fn(),
      update: jest.fn()
    },
    mediaAsset: { update: jest.fn() },
    mediaVariant: { updateMany: jest.fn() }
  };
  const prisma = {
    healthcareVerification: { findMany: jest.fn() },
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => unknown) => callback(transaction)
    )
  };
  transaction.healthcareVerification.findUnique.mockResolvedValue({
    id: "verification_1",
    submissionStatus: HealthcareSubmissionStatus.deletion_pending,
    evidence: [evidence]
  });
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    info: jest.fn(),
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn()
  };
  const service = new HealthcareEvidenceDeletionService(
    prisma as unknown as PrismaService,
    new ConfigService({ HEALTHCARE_EVIDENCE_DELETION_MAX_ATTEMPTS: 2 }),
    storage
  );
  return { service, prisma, transaction, storage };
}

describe("HealthcareEvidenceDeletionService", () => {
  it("is idempotent after evidence has already been deleted", async () => {
    const { service, transaction, storage } = createService();
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      submissionStatus: HealthcareSubmissionStatus.evidence_deleted,
      evidence: []
    });

    await expect(service.deleteSubmission("verification_1")).resolves.toEqual({
      id: "verification_1",
      status: HealthcareSubmissionStatus.evidence_deleted
    });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(transaction.healthcareVerificationEvidence.updateMany).not.toHaveBeenCalled();
  });

  it("marks evidence deleted only after every provider object is confirmed absent", async () => {
    const { service, transaction, storage } = createService();

    await service.deleteSubmission("verification_1");

    expect(storage.remove).toHaveBeenCalledWith("healthcare-credentials", [
      "private/original.jpg",
      "private/review.webp"
    ]);
    expect(storage.exists).toHaveBeenCalledTimes(2);
    expect(transaction.mediaAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: MediaAssetStatus.deleted })
    }));
    expect(transaction.healthcareVerification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        submissionStatus: HealthcareSubmissionStatus.evidence_deleted
      })
    }));
  });

  it("does not claim deletion when the provider still reports an object", async () => {
    const { service, transaction, storage } = createService();
    storage.exists.mockResolvedValueOnce(true);

    await expect(service.deleteSubmission("verification_1")).rejects.toThrow(
      "HEALTHCARE_EVIDENCE_DELETE_NOT_CONFIRMED"
    );
    expect(transaction.mediaAsset.update).not.toHaveBeenCalled();
  });

  it("surfaces terminal provider failure as deletion_failed", async () => {
    const { service, transaction, storage } = createService();
    transaction.healthcareVerification.findUnique.mockResolvedValue({
      id: "verification_1",
      submissionStatus: HealthcareSubmissionStatus.deletion_pending,
      evidence: [{
        id: "evidence_1",
        deletionAttempts: 1,
        mediaAsset: {
          id: "asset_1",
          ingestBucket: "healthcare-credentials",
          ingestStoragePath: "private/original.jpg",
          ingestDeletedAt: null,
          variants: []
        }
      }]
    });
    storage.remove.mockRejectedValue(new Error("provider unavailable"));

    await expect(service.deleteSubmission("verification_1")).rejects.toThrow(
      "provider unavailable"
    );
    expect(transaction.healthcareVerification.update).toHaveBeenLastCalledWith({
      where: { id: "verification_1" },
      data: expect.objectContaining({
        submissionStatus: HealthcareSubmissionStatus.deletion_failed,
        deletionFailedAt: expect.any(Date)
      })
    });
  });
});
