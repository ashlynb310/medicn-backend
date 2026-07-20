import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  EmailWebhookProcessingStatus,
  JobExecutionState,
  OutboxEventStatus,
  Prisma,
  UserRole
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import type {
  ListHostTransfersQueryDto,
  ListJobExecutionsQueryDto,
  ListOperationalCommandsQueryDto,
  ListPaymentsQueryDto,
  OperationalPageQueryDto
} from "./dto/operations.dto";
import { OPERATIONAL_DATE_RANGE_DAYS } from "./dto/operations.dto";

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async listPayments(token: string, query: ListPaymentsQueryDto) {
    await this.requireAdmin(token);
    const { page, limit, createdAt } = this.page(query);
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(createdAt ? { createdAt } : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        select: this.paymentListSelect(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);
    return this.pageResult(rows.map((row) => this.paymentSummary(row)), page, limit, total);
  }

  async getPayment(token: string, id: string) {
    await this.requireAdmin(token);
    const row = await this.prisma.payment.findUnique({ where: { id } });
    if (!row) throw this.notFound();
    return {
      ...this.paymentSummary(row),
      providerReferences: {
        checkoutSessionId: row.providerCheckoutSessionId,
        paymentIntentId: row.providerPaymentIntentId,
        chargeId: row.providerChargeId
      },
      lastProviderEventAt: row.lastProviderEventCreatedAt?.toISOString() ?? null
    };
  }

  async listHostTransfers(token: string, query: ListHostTransfersQueryDto) {
    await this.requireAdmin(token);
    const { page, limit, createdAt } = this.page(query);
    const where: Prisma.HostTransferWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reversalStatus ? { reversalStatus: query.reversalStatus } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(createdAt ? { createdAt } : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.hostTransfer.count({ where }),
      this.prisma.hostTransfer.findMany({
        where,
        select: this.hostTransferListSelect(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);
    return this.pageResult(
      rows.map((row) => this.hostTransferSummary(row)),
      page,
      limit,
      total
    );
  }

  async getHostTransfer(token: string, id: string) {
    await this.requireAdmin(token);
    const row = await this.prisma.hostTransfer.findUnique({ where: { id } });
    if (!row) throw this.notFound();
    return {
      ...this.hostTransferSummary(row),
      hostId: row.hostId,
      failureCode: row.failureCode,
      reversalFailureCode: row.reversalFailureCode,
      providerReferences: {
        connectedAccountId: row.providerConnectedAccountId,
        transferId: row.providerTransferId,
        reversalIds: this.stringArray(row.reversalProviderIds)
      }
    };
  }

  async listJobExecutions(
    token: string,
    query: ListJobExecutionsQueryDto,
    failedOnly = false
  ) {
    await this.requireAdmin(token);
    const { page, limit, createdAt } = this.page(query);
    const where: Prisma.JobExecutionWhereInput = {
      ...(failedOnly ? { state: JobExecutionState.failed } : query.state ? { state: query.state } : {}),
      ...(query.jobType ? { jobType: query.jobType } : {}),
      ...(query.queueName ? { queueName: query.queueName } : {}),
      ...(createdAt ? { createdAt } : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.jobExecution.count({ where }),
      this.prisma.jobExecution.findMany({
        where,
        select: this.jobExecutionSelect(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);
    return this.pageResult(
      rows.map((row) => this.jobExecutionSummary(row)),
      page,
      limit,
      total
    );
  }

  async getJobExecution(token: string, id: string) {
    await this.requireAdmin(token);
    const row = await this.prisma.jobExecution.findUnique({ where: { id } });
    if (!row) throw this.notFound();
    return this.jobExecutionSummary(row);
  }

  async listCommands(token: string, query: ListOperationalCommandsQueryDto) {
    await this.requireAdmin(token);
    const { page, limit, createdAt } = this.page(query);
    const where: Prisma.OperationalCommandWhereInput = {
      ...(query.commandType ? { commandType: query.commandType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.operationalCommand.count({ where }),
      this.prisma.operationalCommand.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);
    return this.pageResult(rows.map((row) => this.commandSummary(row)), page, limit, total);
  }

  async getCommand(token: string, id: string) {
    await this.requireAdmin(token);
    const row = await this.prisma.operationalCommand.findUnique({ where: { id } });
    if (!row) throw this.notFound();
    return this.commandSummary(row);
  }

  async status(token: string) {
    await this.requireAdmin(token);
    const now = Date.now();
    const staleMs = this.config.get<number>("WORKER_HEARTBEAT_STALE_MS") ?? 60_000;
    const [outbox, oldest, failedExecutions, failedWebhooks, unmatchedWebhooks, healthcareDeletionFailures, cancellationOperations, heartbeats] = await Promise.all([
      this.prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: { in: [OutboxEventStatus.pending, OutboxEventStatus.publishing] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true }
      }),
      this.prisma.jobExecution.count({ where: { state: JobExecutionState.failed } }),
      this.prisma.emailWebhookEvent.count({ where: { status: EmailWebhookProcessingStatus.failed } }),
      this.prisma.emailWebhookEvent.count({ where: { status: EmailWebhookProcessingStatus.unmatched } }),
      this.prisma.healthcareVerification.count({ where: { submissionStatus: "deletion_failed" } }),
      this.prisma.bookingCancellationOperation.groupBy({
        by: ["status"],
        where: {
          active: true,
          status: {
            in: [
              "checkout_expiry_pending",
              "refund_pending",
              "transfer_reversal_pending",
              "failed_retryable",
              "failed_permanent"
            ]
          }
        },
        _count: { _all: true }
      }),
      this.prisma.workerHeartbeat.findMany({
        orderBy: { lastHeartbeatAt: "desc" },
        take: 100,
        select: { processType: true, instanceId: true, processStartedAt: true, lastHeartbeatAt: true, version: true }
      })
    ]);
    return {
      outbox: {
        counts: Object.fromEntries(outbox.map((row) => [row.status, row._count._all])),
        oldestPendingAgeSeconds: oldest ? Math.max(0, Math.floor((now - oldest.createdAt.getTime()) / 1000)) : 0
      },
      failures: {
        jobExecutions: failedExecutions,
        emailWebhooks: failedWebhooks,
        unmatchedEmailWebhooks: unmatchedWebhooks,
        healthcareEvidenceDeletions: healthcareDeletionFailures,
        bookingCancellations: Object.fromEntries(
          cancellationOperations.map((row) => [row.status, row._count._all])
        )
      },
      workers: heartbeats.map((heartbeat) => ({
        process: heartbeat.processType,
        instance: heartbeat.instanceId.slice(0, 64),
        processStartedAt: heartbeat.processStartedAt.toISOString(),
        lastHeartbeatAt: heartbeat.lastHeartbeatAt.toISOString(),
        ageSeconds: Math.max(0, Math.floor((now - heartbeat.lastHeartbeatAt.getTime()) / 1000)),
        stale: now - heartbeat.lastHeartbeatAt.getTime() > staleMs,
        version: heartbeat.version.slice(0, 30)
      }))
    };
  }

  private async requireAdmin(token: string) {
    const user = await this.auth.getCurrentUserRecord(token);
    if (!user.roles.includes(UserRole.admin)) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only administrators can inspect operations.",
        details: {}
      });
    }
    return user;
  }

  private page(query: OperationalPageQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = query.createdFrom ? new Date(query.createdFrom) : null;
    const to = query.createdTo ? new Date(query.createdTo) : null;
    if (Boolean(from) !== Boolean(to)) {
      throw new BadRequestException({
        code: "OPERATIONAL_DATE_RANGE_INVALID",
        message: "Operational date filters require both createdFrom and createdTo.",
        details: {}
      });
    }
    if (from && to) {
      const maximum = OPERATIONAL_DATE_RANGE_DAYS * 86_400_000;
      if (to < from || to.getTime() - from.getTime() > maximum) {
        throw new BadRequestException({
          code: "OPERATIONAL_DATE_RANGE_INVALID",
          message: "Operational date filters must be ordered and span at most 366 days.",
          details: {}
        });
      }
    }
    const createdAt = from || to
      ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
      : undefined;
    return { page, limit, createdAt };
  }

  private pageResult<T>(data: T[], page: number, limit: number, total: number) {
    return { data, meta: { page, limit, total }, error: null };
  }

  private paymentListSelect() {
    return {
      id: true,
      bookingId: true,
      attemptNumber: true,
      amountCents: true,
      amountRefundedCents: true,
      currency: true,
      status: true,
      active: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      paidAt: true,
      refundedAt: true
    } as const;
  }

  private paymentSummary(row: {
    id: string;
    bookingId: string;
    attemptNumber: number;
    amountCents: number;
    amountRefundedCents: number;
    currency: string;
    status: string;
    active: boolean;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    paidAt: Date | null;
    refundedAt: Date | null;
  }) {
    return {
      id: row.id,
      bookingId: row.bookingId,
      attemptNumber: row.attemptNumber,
      amountCents: row.amountCents,
      amountRefundedCents: row.amountRefundedCents,
      currency: row.currency,
      status: row.status,
      active: row.active,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      refundedAt: row.refundedAt?.toISOString() ?? null
    };
  }

  private hostTransferListSelect() {
    return {
      id: true,
      bookingId: true,
      paymentId: true,
      grossAmountCents: true,
      platformFeeCents: true,
      hostNetAmountCents: true,
      currency: true,
      status: true,
      reversalStatus: true,
      reversedAmountCents: true,
      reversalTargetAmountCents: true,
      eligibleAt: true,
      transferredAt: true,
      failedAt: true,
      createdAt: true,
      updatedAt: true
    } as const;
  }

  private hostTransferSummary(row: {
    id: string;
    bookingId: string;
    paymentId: string;
    grossAmountCents: number;
    platformFeeCents: number;
    hostNetAmountCents: number;
    currency: string;
    status: string;
    reversalStatus: string;
    reversedAmountCents: number;
    reversalTargetAmountCents: number;
    eligibleAt: Date;
    transferredAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      bookingId: row.bookingId,
      paymentId: row.paymentId,
      grossAmountCents: row.grossAmountCents,
      platformFeeCents: row.platformFeeCents,
      hostNetAmountCents: row.hostNetAmountCents,
      currency: row.currency,
      status: row.status,
      reversalStatus: row.reversalStatus,
      reversedAmountCents: row.reversedAmountCents,
      reversalTargetAmountCents: row.reversalTargetAmountCents,
      eligibleAt: row.eligibleAt.toISOString(),
      transferredAt: row.transferredAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      financialBoundary: {
        movement: "stripe_transfer_to_connected_balance" as const,
        representsBankPayout: false as const
      }
    };
  }

  private jobExecutionSelect() {
    return {
      id: true,
      outboxEventId: true,
      queueName: true,
      jobType: true,
      jobId: true,
      aggregateType: true,
      aggregateId: true,
      attemptNumber: true,
      state: true,
      retryable: true,
      errorCategory: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true
    } as const;
  }

  private jobExecutionSummary(row: {
    id: string;
    outboxEventId: string | null;
    queueName: string;
    jobType: string;
    jobId: string;
    aggregateType: string | null;
    aggregateId: string | null;
    attemptNumber: number;
    state: JobExecutionState;
    retryable: boolean | null;
    errorCategory: string | null;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      outboxEventId: row.outboxEventId,
      queueName: ["email", "media", "maps", "operations"].includes(row.queueName)
        ? row.queueName
        : "unknown",
      jobType: row.jobType.slice(0, 100),
      jobId: row.jobId.slice(0, 64),
      aggregateType: row.aggregateType?.slice(0, 100) ?? null,
      aggregateId: row.aggregateId,
      attemptNumber: row.attemptNumber,
      state: row.state,
      retryable: row.retryable,
      failureCategory: row.errorCategory?.slice(0, 100) ?? null,
      classification: row.state !== JobExecutionState.failed
        ? row.state
        : row.retryable === true
          ? "retryable_failed"
          : "dead_letter",
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private commandSummary(row: {
    id: string;
    commandType: string;
    source: string;
    requestedById: string | null;
    targetId: string | null;
    status: string;
    batchLimit: number | null;
    staleBefore: Date | null;
    scannedCount: number;
    succeededCount: number;
    skippedCount: number;
    retryableFailureCount: number;
    permanentFailureCount: number;
    providerCallCount: number;
    resultCode: string | null;
    lastFailureCategory: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      commandType: row.commandType,
      source: row.source,
      targetId: row.targetId,
      status: row.status,
      batchLimit: row.batchLimit,
      staleBefore: row.staleBefore?.toISOString() ?? null,
      counts: {
        scanned: row.scannedCount,
        succeeded: row.succeededCount,
        skipped: row.skippedCount,
        retryableFailures: row.retryableFailureCount,
        permanentFailures: row.permanentFailureCount,
        providerCalls: row.providerCallCount
      },
      resultCode: row.resultCode,
      lastFailureCategory: row.lastFailureCategory,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private stringArray(value: Prisma.JsonValue) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "The requested operational resource was not found.",
      details: {}
    });
  }
}
