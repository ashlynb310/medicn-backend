import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AdminActionType,
  AdminTargetType,
  HealthcareSubmissionStatus,
  MediaAssetStatus,
  MediaVariantType,
  Prisma,
  UserRole,
  VerificationStatus,
  type User
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { JobsService } from "../jobs/jobs.service";
import { MEDIA_STORAGE, type MediaStorage } from "../media/media-storage";
import { PrismaService } from "../prisma/prisma.service";
import type { DecideHealthcareVerificationDto } from "./dto/decide-healthcare-verification.dto";
import type { ListHealthcareVerificationsDto } from "./dto/list-healthcare-verifications.dto";
import { DELETE_HEALTHCARE_EVIDENCE_JOB } from "./healthcare.types";

@Injectable()
export class HealthcareAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage
  ) {}

  async list(token: string, query: ListHealthcareVerificationsDto) {
    await this.admin(token);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.HealthcareVerificationWhereInput = {
      submissionStatus: query.status ?? HealthcareSubmissionStatus.pending_review,
      ...(query.role ? { claimedRole: query.role } : {}),
      ...(query.evidenceCategory ? { evidenceCategory: query.evidenceCategory } : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.healthcareVerification.count({ where }),
      this.prisma.healthcareVerification.findMany({
        where,
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: { evidence: { include: { mediaAsset: true } } }
      })
    ]);
    return {
      data: rows.map((row) => this.adminSummary(row)),
      meta: { page, limit, total },
      error: null
    };
  }

  async detail(token: string, id: string) {
    await this.admin(token);
    const row = await this.prisma.healthcareVerification.findFirst({
      where: { id },
      include: { evidence: { include: { mediaAsset: true } } }
    });
    if (!row) throw this.notFound();
    return {
      ...this.adminSummary(row),
      decision: row.reviewedAt ? {
        status: row.status,
        reviewerId: row.reviewedByAdminId,
        decidedAt: row.reviewedAt.toISOString(),
        reasonCode: row.decisionReasonCode,
        note: row.adminReviewNote
      } : null
    };
  }

  async viewEvidence(token: string, verificationId: string, evidenceId: string) {
    const admin = await this.admin(token);
    const evidence = await this.prisma.healthcareVerificationEvidence.findFirst({
      where: {
        id: evidenceId,
        healthcareVerificationId: verificationId,
        healthcareVerification: {
          submissionStatus: HealthcareSubmissionStatus.pending_review
        },
        mediaAsset: { status: MediaAssetStatus.ready }
      },
      include: {
        mediaAsset: {
          include: {
            variants: {
              where: { type: MediaVariantType.healthcare_review, deletedAt: null }
            }
          }
        }
      }
    });
    const variant = evidence?.mediaAsset.variants[0];
    if (!evidence || !variant) throw this.notFound();

    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.healthcareVerificationEvidence.update({
        where: { id: evidence.id },
        data: { lastAccessedAt: now, accessCount: { increment: 1 } }
      });
      await transaction.adminAction.create({
        data: {
          adminId: admin.id,
          targetType: AdminTargetType.healthcare_evidence,
          targetId: evidence.id,
          action: AdminActionType.evidence_viewed,
          note: `verification=${verificationId}`
        }
      });
    });
    const ttlSeconds = Math.min(
      60,
      this.config.get<number>("HEALTHCARE_EVIDENCE_VIEW_URL_TTL_SECONDS") ?? 60
    );
    const viewUrl = await this.storage.createSignedDownloadUrl(
      variant.storageBucket,
      variant.storagePath,
      ttlSeconds
    );
    return {
      evidenceId: evidence.id,
      viewUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
    };
  }

  async decide(token: string, id: string, input: DecideHealthcareVerificationDto) {
    const admin = await this.admin(token);
    const decisionStatus = input.status === "approved"
      ? VerificationStatus.approved
      : VerificationStatus.rejected;
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "HealthcareVerification"
        WHERE "id" = ${id}
        FOR UPDATE
      `);
      if (!locked[0]) throw this.notFound();
      const verification = await transaction.healthcareVerification.findUnique({
        where: { id },
        include: { evidence: { include: { mediaAsset: true } } }
      });
      if (!verification) throw this.notFound();
      if (verification.submissionStatus !== HealthcareSubmissionStatus.pending_review) {
        throw new ConflictException({
          code: "HEALTHCARE_DECISION_CONFLICT",
          message: "Only a pending healthcare submission may be decided.",
          details: {}
        });
      }
      if (
        verification.evidence.length < 1 ||
        verification.evidence.some(({ mediaAsset }) => mediaAsset.status !== MediaAssetStatus.ready)
      ) {
        throw new ConflictException({
          code: "HEALTHCARE_EVIDENCE_NOT_READY",
          message: "Sanitized evidence is not ready for a decision.",
          details: {}
        });
      }
      const now = new Date();
      const note = input.note?.trim() || null;
      const updated = await transaction.healthcareVerification.update({
        where: { id },
        data: {
          submissionStatus: HealthcareSubmissionStatus.deletion_pending,
          status: decisionStatus,
          reviewedByAdminId: admin.id,
          reviewedAt: now,
          adminReviewNote: note,
          decisionReasonCode: input.reasonCode,
          deletionRequestedAt: now
        }
      });
      await transaction.healthcareVerificationEvidence.updateMany({
        where: { healthcareVerificationId: id, deletedAt: null },
        data: { deletionRequestedAt: now }
      });
      await transaction.user.update({
        where: { id: verification.userId },
        data: { currentVerificationStatus: decisionStatus }
      });
      await transaction.adminAction.create({
        data: {
          adminId: admin.id,
          targetType: AdminTargetType.healthcare_verification,
          targetId: id,
          action: input.status === "approved" ? AdminActionType.approve : AdminActionType.reject,
          note: `pending_review->${input.status};reason=${input.reasonCode}`
        }
      });
      await this.jobs.enqueue(
        DELETE_HEALTHCARE_EVIDENCE_JOB,
        { healthcareVerificationId: id },
        {
          aggregateId: id,
          aggregateType: "healthcare_verification",
          client: transaction,
          deduplicationKey: `healthcare-evidence-delete:${id}`,
          maxAttempts: 5
        }
      );
      return {
        id: updated.id,
        status: updated.submissionStatus,
        decision: input.status,
        reasonCode: input.reasonCode,
        decidedAt: now.toISOString()
      };
    });
  }

  private async admin(token: string): Promise<User> {
    const actor = await this.auth.getCurrentUserRecord(token);
    if (!actor.roles.includes(UserRole.admin)) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only administrators may review healthcare verifications.",
        details: {}
      });
    }
    return actor;
  }

  private adminSummary(row: {
    id: string;
    userId: string;
    version: number;
    claimedRole: unknown;
    claimedAffiliationName: string | null;
    claimedAffiliationType: unknown;
    evidenceCategory: unknown;
    submissionStatus: HealthcareSubmissionStatus;
    submittedAt: Date | null;
    createdAt: Date;
    evidence: Array<{ id: string; sanitizedAt?: Date | null; mediaAsset: { status: MediaAssetStatus } }>;
  }) {
    return {
      id: row.id,
      userId: row.userId,
      version: row.version,
      claimedRole: row.claimedRole,
      claimedAffiliationName: row.claimedAffiliationName,
      claimedAffiliationType: row.claimedAffiliationType,
      evidenceCategory: row.evidenceCategory,
      status: row.submissionStatus,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      evidence: row.evidence.map((evidence) => ({
        id: evidence.id,
        ready: evidence.mediaAsset.status === MediaAssetStatus.ready,
        sanitizedAt: evidence.sanitizedAt?.toISOString() ?? null
      }))
    };
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Healthcare verification was not found.",
      details: {}
    });
  }
}
