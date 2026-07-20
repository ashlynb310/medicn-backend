import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  HealthcareSubmissionStatus,
  MediaAssetStatus,
  Prisma
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MEDIA_STORAGE, type MediaStorage } from "../media/media-storage";

@Injectable()
export class HealthcareEvidenceDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage
  ) {}

  async deleteSubmission(verificationId: string) {
    const claimed = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `healthcare-deletion:${verificationId}`);
      const verification = await transaction.healthcareVerification.findUnique({
        where: { id: verificationId },
        include: {
          evidence: {
            include: { mediaAsset: { include: { variants: true } } }
          }
        }
      });
      if (!verification || verification.submissionStatus === HealthcareSubmissionStatus.evidence_deleted) {
        return null;
      }
      await transaction.healthcareVerificationEvidence.updateMany({
        where: { healthcareVerificationId: verificationId, deletedAt: null },
        data: { deletionAttempts: { increment: 1 } }
      });
      return {
        ...verification,
        attempt: Math.max(0, ...verification.evidence.map(({ deletionAttempts }) => deletionAttempts)) + 1
      };
    });
    if (!claimed) return { id: verificationId, status: HealthcareSubmissionStatus.evidence_deleted };

    try {
      for (const evidence of claimed.evidence) {
        const paths = new Map<string, string[]>();
        if (!evidence.mediaAsset.ingestDeletedAt) {
          this.addPath(paths, evidence.mediaAsset.ingestBucket, evidence.mediaAsset.ingestStoragePath);
        }
        for (const variant of evidence.mediaAsset.variants) {
          if (!variant.deletedAt) this.addPath(paths, variant.storageBucket, variant.storagePath);
        }
        for (const [bucket, bucketPaths] of paths) {
          await this.storage.remove(bucket, bucketPaths);
          for (const path of bucketPaths) {
            if (await this.storage.exists(bucket, path)) {
              throw new Error("HEALTHCARE_EVIDENCE_DELETE_NOT_CONFIRMED");
            }
          }
        }
      }

      const now = new Date();
      await this.prisma.$transaction(async (transaction) => {
        await this.lock(transaction, `healthcare-deletion:${verificationId}`);
        for (const evidence of claimed.evidence) {
          await transaction.mediaAsset.update({
            where: { id: evidence.mediaAsset.id },
            data: {
              status: MediaAssetStatus.deleted,
              ingestDeletedAt: now,
              deletedAt: now,
              cleanupRequestedAt: null
            }
          });
          await transaction.mediaVariant.updateMany({
            where: { mediaAssetId: evidence.mediaAsset.id, deletedAt: null },
            data: { deletedAt: now }
          });
          await transaction.healthcareVerificationEvidence.update({
            where: { id: evidence.id },
            data: {
              deletedAt: now,
              deletionFailedAt: null,
              lastDeletionErrorCode: null
            }
          });
        }
        await transaction.healthcareVerification.update({
          where: { id: verificationId },
          data: {
            submissionStatus: HealthcareSubmissionStatus.evidence_deleted,
            evidenceDeletedAt: now,
            deletionFailedAt: null
          }
        });
      });
      return { id: verificationId, status: HealthcareSubmissionStatus.evidence_deleted };
    } catch (error) {
      await this.recordFailure(verificationId, claimed.attempt);
      throw error;
    }
  }

  async recover(limit: number) {
    const rows = await this.prisma.healthcareVerification.findMany({
      where: {
        submissionStatus: {
          in: [
            HealthcareSubmissionStatus.deletion_pending,
            HealthcareSubmissionStatus.deletion_failed
          ]
        }
      },
      orderBy: { deletionRequestedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true }
    });
    let recovered = 0;
    for (const row of rows) {
      try {
        await this.deleteSubmission(row.id);
        recovered += 1;
      } catch {
        // The durable lifecycle and worker execution record retain the failure.
      }
    }
    return recovered;
  }

  private async recordFailure(verificationId: string, attempt: number) {
    const terminal = attempt >= this.maxAttempts();
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.healthcareVerificationEvidence.updateMany({
        where: { healthcareVerificationId: verificationId, deletedAt: null },
        data: {
          deletionFailedAt: terminal ? now : null,
          lastDeletionErrorCode: "STORAGE_DELETE_FAILED"
        }
      });
      await transaction.healthcareVerification.update({
        where: { id: verificationId },
        data: terminal ? {
          submissionStatus: HealthcareSubmissionStatus.deletion_failed,
          deletionFailedAt: now
        } : {
          submissionStatus: HealthcareSubmissionStatus.deletion_pending
        }
      });
    });
  }

  private addPath(groups: Map<string, string[]>, bucket: string, path: string) {
    groups.set(bucket, [...(groups.get(bucket) ?? []), path]);
  }

  private maxAttempts() {
    return this.config.get<number>("HEALTHCARE_EVIDENCE_DELETION_MAX_ATTEMPTS") ?? 5;
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }
}
