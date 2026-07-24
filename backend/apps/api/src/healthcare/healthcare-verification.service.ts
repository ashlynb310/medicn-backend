import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  HealthcareSubmissionStatus,
  MediaAssetStatus,
  MediaPurpose,
  Prisma,
  VerificationStatus
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { IdentityEligibilityService } from "../identity/identity-eligibility.service";
import { JobsService } from "../jobs/jobs.service";
import { MEDIA_STORAGE, type MediaStorage } from "../media/media-storage";
import { PROCESS_MEDIA_ASSET_JOB } from "../media/media.types";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateHealthcareEvidenceUploadDto } from "./dto/create-healthcare-evidence-upload.dto";
import type { CreateHealthcareVerificationDto } from "./dto/create-healthcare-verification.dto";
import { DELETE_HEALTHCARE_EVIDENCE_JOB } from "./healthcare.types";

const UPLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_EVIDENCE_IMAGES = 3;
const ACTIVE_STATUSES = [
  HealthcareSubmissionStatus.created,
  HealthcareSubmissionStatus.uploading,
  HealthcareSubmissionStatus.processing,
  HealthcareSubmissionStatus.pending_review
] as const;

@Injectable()
export class HealthcareVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly identityEligibility: IdentityEligibilityService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage
  ) {}

  async create(token: string, input: CreateHealthcareVerificationDto) {
    const actor = await this.auth.getCurrentUserRecord(token);
    await this.identityEligibility.assertApproved(actor.id);
    const affiliationName = input.claimedAffiliationName.trim();
    if (!affiliationName) throw this.validation("VALIDATION_ERROR", "Affiliation name is required.");

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        await this.lock(transaction, `healthcare-submission:${actor.id}`);
        const active = await transaction.healthcareVerification.count({
          where: { userId: actor.id, submissionStatus: { in: [...ACTIVE_STATUSES] } }
        });
        if (active > 0) throw this.activeSubmission();
        const aggregate = await transaction.healthcareVerification.aggregate({
          where: { userId: actor.id },
          _max: { version: true }
        });
        return transaction.healthcareVerification.create({
          data: {
            userId: actor.id,
            version: (aggregate._max.version ?? 0) + 1,
            claimedRole: input.claimedRole,
            claimedAffiliationName: affiliationName,
            claimedAffiliationType: input.claimedAffiliationType,
            evidenceCategory: input.evidenceCategory,
            submissionStatus: HealthcareSubmissionStatus.created,
            status: VerificationStatus.not_started,
            legacyRecord: false
          },
          include: { evidence: { include: { mediaAsset: true } } }
        });
      });
      return this.toSubject(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.activeSubmission();
      throw error;
    }
  }

  async createUploadIntent(
    token: string,
    verificationId: string,
    input: CreateHealthcareEvidenceUploadDto
  ) {
    const actor = await this.auth.getCurrentUserRecord(token);
    const assetId = randomUUID();
    const evidenceId = randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const bucket = this.bucket();
    const path = [
      "healthcare-evidence",
      actor.id,
      verificationId,
      evidenceId,
      "original",
      assetId,
      this.safeFileName(input.fileName)
    ].join("/");

    const created = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `healthcare-submission:${verificationId}`);
      const verification = await transaction.healthcareVerification.findUnique({
        where: { id: verificationId }
      });
      if (!verification || verification.userId !== actor.id) throw this.notFound();
      if (
        verification.submissionStatus !== HealthcareSubmissionStatus.created &&
        verification.submissionStatus !== HealthcareSubmissionStatus.uploading &&
        verification.submissionStatus !== HealthcareSubmissionStatus.processing
      ) {
        throw this.conflict("HEALTHCARE_SUBMISSION_NOT_EDITABLE", "The submission cannot accept more evidence.");
      }
      const evidenceCount = await transaction.healthcareVerificationEvidence.count({
        where: { healthcareVerificationId: verificationId }
      });
      if (evidenceCount >= MAX_EVIDENCE_IMAGES) {
        throw this.validation("HEALTHCARE_EVIDENCE_LIMIT_REACHED", "A submission may contain at most three evidence images.");
      }
      const mediaAsset = await transaction.mediaAsset.create({
        data: {
          id: assetId,
          purpose: MediaPurpose.healthcare_credential,
          ownerUserId: actor.id,
          ingestBucket: bucket,
          ingestStoragePath: path,
          claimedFileName: input.fileName,
          claimedContentType: input.contentType,
          expiresAt
        }
      });
      const evidence = await transaction.healthcareVerificationEvidence.create({
        data: {
          id: evidenceId,
          healthcareVerificationId: verificationId,
          mediaAssetId: mediaAsset.id
        }
      });
      await transaction.healthcareVerification.update({
        where: { id: verificationId },
        data: { submissionStatus: HealthcareSubmissionStatus.uploading }
      });
      return { evidence, mediaAsset };
    });

    try {
      const uploadUrl = await this.storage.createSignedUploadUrl(
        created.mediaAsset.ingestBucket,
        created.mediaAsset.ingestStoragePath
      );
      return {
        evidenceId: created.evidence.id,
        uploadUrl,
        expiresAt: created.mediaAsset.expiresAt.toISOString()
      };
    } catch (error) {
      await this.markIntentFailed(verificationId, created.mediaAsset.id);
      throw error;
    }
  }

  async completeUpload(token: string, verificationId: string, evidenceId: string) {
    const actor = await this.auth.getCurrentUserRecord(token);
    const evidence = await this.prisma.$transaction((transaction) =>
      transaction.healthcareVerificationEvidence.findFirst({
        where: {
          id: evidenceId,
          healthcareVerificationId: verificationId,
          healthcareVerification: { userId: actor.id }
        },
        include: { mediaAsset: true }
      })
    );
    if (!evidence) throw this.notFound();
    if (evidence.mediaAsset.status !== MediaAssetStatus.pending_upload) {
      return this.evidenceState(evidence.id, evidence.mediaAsset.status);
    }
    if (evidence.mediaAsset.expiresAt <= new Date()) {
      await this.markIntentFailed(verificationId, evidence.mediaAssetId, "UPLOAD_EXPIRED");
      throw this.validation("MEDIA_UPLOAD_EXPIRED", "The upload intent expired.");
    }
    const { ingestBucket, ingestStoragePath } = evidence.mediaAsset;
    if (!(await this.storage.exists(ingestBucket, ingestStoragePath))) {
      throw this.validation("MEDIA_UPLOAD_OBJECT_MISSING", "The expected uploaded object was not found.");
    }
    const info = await this.storage.info(ingestBucket, ingestStoragePath);
    if (info.size > this.maxInputBytes()) {
      await this.markIntentFailed(verificationId, evidence.mediaAssetId, "INPUT_TOO_LARGE", info.size);
      throw this.validation("MEDIA_INPUT_TOO_LARGE", "The uploaded image exceeds the 10 MB limit.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-asset:${evidence.mediaAssetId}`);
      const current = await transaction.mediaAsset.findUniqueOrThrow({
        where: { id: evidence.mediaAssetId }
      });
      if (current.status !== MediaAssetStatus.pending_upload) return;
      await transaction.mediaAsset.update({
        where: { id: current.id },
        data: {
          status: MediaAssetStatus.uploaded,
          uploadedAt: new Date(),
          originalByteSize: info.size
        }
      });
      await transaction.healthcareVerification.update({
        where: { id: verificationId },
        data: { submissionStatus: HealthcareSubmissionStatus.processing }
      });
      await this.jobs.enqueue(PROCESS_MEDIA_ASSET_JOB, { assetId: current.id }, {
        aggregateId: current.id,
        aggregateType: "media_asset",
        client: transaction,
        deduplicationKey: `media-process:${current.id}`,
        maxAttempts: 5
      });
    });
    return this.evidenceState(evidence.id, MediaAssetStatus.uploaded);
  }

  async submit(token: string, verificationId: string) {
    const actor = await this.auth.getCurrentUserRecord(token);
    const submitted = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `healthcare-submission:${verificationId}`);
      const verification = await transaction.healthcareVerification.findUnique({
        where: { id: verificationId },
        include: {
          evidence: {
            include: {
              mediaAsset: { include: { variants: { where: { deletedAt: null } } } }
            }
          }
        }
      });
      if (!verification || verification.userId !== actor.id) throw this.notFound();
      if (verification.submissionStatus === HealthcareSubmissionStatus.pending_review) {
        return verification;
      }
      const ready = verification.evidence.length >= 1 &&
        verification.evidence.length <= MAX_EVIDENCE_IMAGES &&
        verification.evidence.every(({ mediaAsset }) =>
          mediaAsset.status === MediaAssetStatus.ready &&
          mediaAsset.ingestDeletedAt !== null &&
          mediaAsset.variants.some(({ type }) => type === "healthcare_review")
        );
      if (!ready) {
        throw this.conflict("HEALTHCARE_EVIDENCE_NOT_READY", "One to three sanitized evidence images are required.");
      }
      const now = new Date();
      const updated = await transaction.healthcareVerification.update({
        where: { id: verificationId },
        data: {
          submissionStatus: HealthcareSubmissionStatus.pending_review,
          status: VerificationStatus.pending,
          submittedAt: verification.submittedAt ?? now
        },
        include: { evidence: { include: { mediaAsset: true } } }
      });
      await transaction.user.update({
        where: { id: actor.id },
        data: { currentVerificationStatus: VerificationStatus.pending }
      });
      return updated;
    });
    return this.toSubject(submitted);
  }

  async getMine(token: string) {
    const actor = await this.auth.getCurrentUserRecord(token);
    const history = await this.prisma.healthcareVerification.findMany({
      where: { userId: actor.id },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      include: { evidence: { include: { mediaAsset: true } } }
    });
    return {
      current: history[0] ? this.toSubject(history[0]) : null,
      history: history.map((verification) => this.toSubject(verification))
    };
  }

  async withdraw(token: string, verificationId: string) {
    const actor = await this.auth.getCurrentUserRecord(token);
    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `healthcare-submission:${verificationId}`);
      const verification = await transaction.healthcareVerification.findUnique({
        where: { id: verificationId },
        include: { evidence: { include: { mediaAsset: true } } }
      });
      if (!verification || verification.userId !== actor.id) throw this.notFound();
      if (verification.reviewedAt || verification.reviewedByAdminId) {
        throw this.conflict("HEALTHCARE_DECISION_FINAL", "A decided submission cannot be withdrawn.");
      }
      if (verification.withdrawnAt) return verification;
      const now = new Date();
      await transaction.healthcareVerificationEvidence.updateMany({
        where: { healthcareVerificationId: verificationId, deletedAt: null },
        data: { deletionRequestedAt: now }
      });
      const updated = await transaction.healthcareVerification.update({
        where: { id: verificationId },
        data: {
          submissionStatus: HealthcareSubmissionStatus.deletion_pending,
          withdrawnAt: now,
          deletionRequestedAt: now
        },
        include: { evidence: { include: { mediaAsset: true } } }
      });
      await this.queueDeletion(transaction, verificationId);
      await transaction.user.update({
        where: { id: actor.id },
        data: { currentVerificationStatus: await this.previousCompatibilityStatus(transaction, actor.id, verificationId) }
      });
      return updated;
    });
    return this.toSubject(result);
  }

  private async markIntentFailed(
    verificationId: string,
    assetId: string,
    code = "UPLOAD_URL_FAILED",
    originalByteSize?: number
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.mediaAsset.update({
        where: { id: assetId },
        data: {
          status: MediaAssetStatus.rejected,
          rejectionCode: code,
          rejectionReason: "Healthcare evidence upload could not be accepted.",
          originalByteSize,
          failedAt: now,
          cleanupRequestedAt: now
        }
      });
      await transaction.healthcareVerification.update({
        where: { id: verificationId },
        data: { submissionStatus: HealthcareSubmissionStatus.processing_failed }
      });
      await this.jobs.enqueue("cleanup_media_asset", { assetId }, {
        aggregateId: assetId,
        aggregateType: "media_asset",
        client: transaction,
        deduplicationKey: `media-cleanup:${assetId}`,
        maxAttempts: 5
      });
    });
  }

  private queueDeletion(transaction: Prisma.TransactionClient, verificationId: string) {
    return this.jobs.enqueue(
      DELETE_HEALTHCARE_EVIDENCE_JOB,
      { healthcareVerificationId: verificationId },
      {
        aggregateId: verificationId,
        aggregateType: "healthcare_verification",
        client: transaction,
        deduplicationKey: `healthcare-evidence-delete:${verificationId}`,
        maxAttempts: 5
      }
    );
  }

  private async previousCompatibilityStatus(
    transaction: Prisma.TransactionClient,
    userId: string,
    excludedId: string
  ) {
    const previous = await transaction.healthcareVerification.findFirst({
      where: {
        userId,
        id: { not: excludedId },
        status: { in: [VerificationStatus.approved, VerificationStatus.rejected, VerificationStatus.expired] }
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      select: { status: true }
    });
    return previous?.status ?? VerificationStatus.not_started;
  }

  private toSubject(verification: {
    id: string;
    version: number;
    claimedRole: unknown;
    claimedAffiliationName: string | null;
    claimedAffiliationType: unknown;
    evidenceCategory: unknown;
    submissionStatus: HealthcareSubmissionStatus;
    status: VerificationStatus;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    withdrawnAt: Date | null;
    createdAt: Date;
    evidence: Array<{ id: string; mediaAsset: { status: MediaAssetStatus } }>;
  }) {
    return {
      id: verification.id,
      version: verification.version,
      claimedRole: verification.claimedRole,
      claimedAffiliationName: verification.claimedAffiliationName,
      claimedAffiliationType: verification.claimedAffiliationType,
      evidenceCategory: verification.evidenceCategory,
      status: verification.submissionStatus,
      decision: verification.status === VerificationStatus.approved ||
        verification.status === VerificationStatus.rejected
        ? verification.status
        : null,
      submittedAt: verification.submittedAt?.toISOString() ?? null,
      decidedAt: verification.reviewedAt?.toISOString() ?? null,
      withdrawnAt: verification.withdrawnAt?.toISOString() ?? null,
      createdAt: verification.createdAt.toISOString(),
      evidenceCount: verification.evidence.length,
      evidence: verification.evidence.map((item) => ({
        id: item.id,
        status: this.safeEvidenceStatus(item.mediaAsset.status)
      }))
    };
  }

  private safeEvidenceStatus(status: MediaAssetStatus) {
    if (status === MediaAssetStatus.ready) return "ready" as const;
    if (status === MediaAssetStatus.rejected) return "processing_failed" as const;
    if (status === MediaAssetStatus.deleted) return "deleted" as const;
    return "processing" as const;
  }

  private evidenceState(id: string, status: MediaAssetStatus) {
    return { evidenceId: id, status: this.safeEvidenceStatus(status) };
  }

  private maxInputBytes() {
    return this.config.get<number>("HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES") ?? 10_485_760;
  }

  private bucket() {
    return this.config.get<string>("SUPABASE_HEALTHCARE_EVIDENCE_BUCKET") ?? "healthcare-credentials";
  }

  private safeFileName(value: string) {
    const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return cleaned || "evidence";
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private activeSubmission() {
    return this.conflict("HEALTHCARE_SUBMISSION_ACTIVE", "An active healthcare submission already exists.");
  }

  private validation(code: string, message: string) {
    return new BadRequestException({ code, message, details: {} });
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message, details: {} });
  }

  private notFound() {
    return new NotFoundException({ code: "NOT_FOUND", message: "Healthcare verification was not found.", details: {} });
  }
}
