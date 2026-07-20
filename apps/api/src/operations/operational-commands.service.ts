import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  JobExecutionState,
  OperationalCommandSource,
  OperationalCommandStatus,
  OperationalCommandType,
  Prisma,
  UserRole
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ReconcileHostTransfersDto,
  ReconcilePaymentsDto,
  RequeueJobExecutionDto
} from "../admin/dto/operations.dto";
import { JobRecoveryService, RECOVERABLE_QUEUE_NAMES } from "./job-recovery.service";
import {
  EXECUTE_OPERATIONAL_COMMAND_JOB,
  type ExecuteOperationalCommandPayload
} from "./operational-command.types";
import { FinancialReconciliationService } from "../payments/financial-reconciliation.service";
import {
  classifyOperationalError,
  OperationalError
} from "../jobs/operational-error";

@Injectable()
export class OperationalCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jobs: JobsService,
    private readonly recovery: JobRecoveryService,
    private readonly reconciliation: FinancialReconciliationService
  ) {}

  async queueJobRequeue(
    token: string,
    executionId: string,
    input: RequeueJobExecutionDto
  ) {
    const admin = await this.requireAdmin(token);
    const existing = await this.existingOrConflict({
      commandType: OperationalCommandType.job_requeue,
      idempotencyKey: input.idempotencyKey,
      targetId: executionId,
      reason: input.reason,
      requestedById: admin.id
    });
    if (existing) return this.toDto(existing);

    const execution = await this.prisma.jobExecution.findUnique({
      where: { id: executionId },
      select: { state: true, retryable: true, queueName: true }
    });
    if (
      !execution ||
      execution.state !== JobExecutionState.failed ||
      execution.retryable !== true ||
      !RECOVERABLE_QUEUE_NAMES.has(execution.queueName)
    ) {
      throw this.notRequeueable();
    }
    return this.createCommand({
      commandType: OperationalCommandType.job_requeue,
      source: OperationalCommandSource.admin_api,
      idempotencyKey: input.idempotencyKey,
      requestedById: admin.id,
      targetId: executionId,
      reason: input.reason
    });
  }

  async queuePaymentReconciliation(token: string, input: ReconcilePaymentsDto) {
    const admin = await this.requireAdmin(token);
    return this.queueReconciliation(
      OperationalCommandType.payment_reconciliation,
      OperationalCommandSource.admin_api,
      admin.id,
      input.paymentId ?? null,
      input
    );
  }

  async queueHostTransferReconciliation(
    token: string,
    input: ReconcileHostTransfersDto
  ) {
    const admin = await this.requireAdmin(token);
    return this.queueReconciliation(
      OperationalCommandType.host_transfer_reconciliation,
      OperationalCommandSource.admin_api,
      admin.id,
      input.hostTransferId ?? null,
      input
    );
  }

  async queueCliReconciliation(
    commandType:
      | typeof OperationalCommandType.payment_reconciliation
      | typeof OperationalCommandType.host_transfer_reconciliation,
    input: {
      idempotencyKey: string;
      reason: string;
      targetId?: string;
      limit?: number;
      staleBefore?: string;
    }
  ) {
    this.validateCliInput(input);
    return this.queueReconciliation(
      commandType,
      OperationalCommandSource.cli,
      null,
      input.targetId ?? null,
      input
    );
  }

  async queueCliRequeue(
    executionId: string,
    input: { idempotencyKey: string; reason: string }
  ) {
    this.validateCliInput(input);
    const existing = await this.existingOrConflict({
      commandType: OperationalCommandType.job_requeue,
      idempotencyKey: input.idempotencyKey,
      targetId: executionId,
      reason: input.reason,
      requestedById: null
    });
    if (existing) return this.toDto(existing);
    const execution = await this.prisma.jobExecution.findUnique({
      where: { id: executionId },
      select: { state: true, retryable: true, queueName: true }
    });
    if (
      !execution ||
      execution.state !== JobExecutionState.failed ||
      execution.retryable !== true ||
      !RECOVERABLE_QUEUE_NAMES.has(execution.queueName)
    ) {
      throw this.notRequeueable();
    }
    return this.createCommand({
      commandType: OperationalCommandType.job_requeue,
      source: OperationalCommandSource.cli,
      idempotencyKey: input.idempotencyKey,
      requestedById: null,
      targetId: executionId,
      reason: input.reason
    });
  }

  async execute(commandId: string) {
    const initial = await this.prisma.operationalCommand.findUnique({
      where: { id: commandId }
    });
    if (!initial) throw this.notFound();
    if (initial.status === OperationalCommandStatus.succeeded) {
      return this.toDto(initial);
    }
    const claimed = await this.prisma.operationalCommand.updateMany({
      where: {
        id: commandId,
        status: {
          in: [
            OperationalCommandStatus.queued,
            OperationalCommandStatus.failed_retryable
          ]
        }
      },
      data: {
        status: OperationalCommandStatus.running,
        startedAt: initial.startedAt ?? new Date(),
        completedAt: null,
        lastFailureCategory: null
      }
    });
    if (claimed.count !== 1) return this.toDto(initial);
    const command = await this.prisma.operationalCommand.findUnique({
      where: { id: commandId }
    });
    if (!command) throw this.notFound();

    let retryRecorded = false;
    try {
      if (command.commandType === OperationalCommandType.job_requeue) {
        if (!command.targetId) throw this.notRequeueable();
        const execution = await this.prisma.jobExecution.findUnique({
          where: { id: command.targetId },
          select: { state: true, retryable: true, queueName: true }
        });
        if (
          !execution ||
          execution.state !== JobExecutionState.failed ||
          execution.retryable !== true ||
          !RECOVERABLE_QUEUE_NAMES.has(execution.queueName)
        ) {
          throw new OperationalError(
            "job_execution_not_requeueable",
            "The inspected job is no longer eligible for a safe requeue.",
            false
          );
        }
        const result = await this.recovery.requeue(command.targetId);
        const completed = await this.prisma.operationalCommand.update({
          where: { id: command.id },
          data: {
            status: OperationalCommandStatus.succeeded,
            scannedCount: 1,
            succeededCount: 1,
            resultCode: result.action,
            completedAt: new Date()
          }
        });
        return this.toDto(completed);
      }

      if (!command.staleBefore || !command.batchLimit) {
        throw new OperationalError(
          "reconciliation_scope_invalid",
          "The durable reconciliation scope is incomplete.",
          false
        );
      }
      const scope = {
        commandId: command.id,
        targetId: command.targetId,
        limit: command.batchLimit,
        staleBefore: command.staleBefore
      };
      const result =
        command.commandType === OperationalCommandType.payment_reconciliation
          ? await this.reconciliation.reconcilePayments(scope)
          : await this.reconciliation.reconcileHostTransfers(scope);
      const status = result.retryableFailures
        ? OperationalCommandStatus.failed_retryable
        : result.permanentFailures
          ? result.succeeded > 0
            ? OperationalCommandStatus.partially_succeeded
            : OperationalCommandStatus.failed_permanent
          : OperationalCommandStatus.succeeded;
      const completed = await this.prisma.operationalCommand.update({
        where: { id: command.id },
        data: {
          status,
          scannedCount: result.scanned,
          succeededCount: result.succeeded,
          skippedCount: result.skipped,
          retryableFailureCount: result.retryableFailures,
          permanentFailureCount: result.permanentFailures,
          providerCallCount: { increment: result.providerCalls },
          resultCode:
            result.scanned === 0
              ? "NO_STALE_CANDIDATES"
              : status === OperationalCommandStatus.succeeded
                ? "RECONCILIATION_SUCCEEDED"
                : status === OperationalCommandStatus.partially_succeeded
                  ? "RECONCILIATION_PARTIAL"
                  : "RECONCILIATION_FAILED",
          lastFailureCategory: result.lastFailureCategory,
          completedAt:
            status === OperationalCommandStatus.failed_retryable
              ? null
              : new Date()
        }
      });
      if (status === OperationalCommandStatus.failed_retryable) {
        retryRecorded = true;
        throw new OperationalError(
          result.lastFailureCategory ?? "provider_unavailable",
          "One or more reconciliation candidates require a bounded retry.",
          true
        );
      }
      return this.toDto(completed);
    } catch (error) {
      if (retryRecorded) {
        throw error;
      }
      const failure = classifyOperationalError(error);
      const failed = await this.prisma.operationalCommand.update({
        where: { id: command.id },
        data: {
          status: failure.retryable
            ? OperationalCommandStatus.failed_retryable
            : OperationalCommandStatus.failed_permanent,
          retryableFailureCount: failure.retryable ? 1 : 0,
          permanentFailureCount: failure.retryable ? 0 : 1,
          resultCode: "OPERATIONAL_COMMAND_FAILED",
          lastFailureCategory: failure.category,
          completedAt: failure.retryable ? null : new Date()
        }
      });
      if (failure.retryable) {
        throw new OperationalError(
          failure.category,
          failure.message,
          true,
          { cause: error }
        );
      }
      return this.toDto(failed);
    }
  }

  private async queueReconciliation(
    commandType:
      | typeof OperationalCommandType.payment_reconciliation
      | typeof OperationalCommandType.host_transfer_reconciliation,
    source: OperationalCommandSource,
    requestedById: string | null,
    targetId: string | null,
    input: {
      idempotencyKey: string;
      reason: string;
      limit?: number;
      staleBefore?: string;
    }
  ) {
    const existing = await this.existingOrConflict({
      commandType,
      idempotencyKey: input.idempotencyKey,
      targetId,
      reason: input.reason,
      requestedById
    });
    if (existing) return this.toDto(existing);
    const staleBefore = input.staleBefore
      ? new Date(input.staleBefore)
      : new Date(Date.now() - 15 * 60_000);
    if (staleBefore > new Date()) {
      throw new UnprocessableEntityException({
        code: "RECONCILIATION_SCOPE_INVALID",
        message: "Reconciliation staleBefore cannot be in the future.",
        details: {}
      });
    }
    return this.createCommand({
      commandType,
      source,
      idempotencyKey: input.idempotencyKey,
      requestedById,
      targetId,
      reason: input.reason,
      batchLimit: targetId ? 1 : Math.min(Math.max(input.limit ?? 10, 1), 25),
      staleBefore
    });
  }

  private validateCliInput(input: {
    idempotencyKey: string;
    reason: string;
    targetId?: string;
    limit?: number;
    staleBefore?: string;
  }) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 200 ||
      !/^[A-Za-z0-9:_-]+$/.test(input.idempotencyKey) ||
      input.reason.trim().length < 10 ||
      input.reason.trim().length > 500 ||
      (input.targetId !== undefined && !uuid.test(input.targetId)) ||
      (input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25)) ||
      (input.staleBefore !== undefined &&
        Number.isNaN(new Date(input.staleBefore).getTime()))
    ) {
      throw new UnprocessableEntityException({
        code: "OPERATIONAL_COMMAND_INVALID",
        message: "The operational command arguments are invalid.",
        details: {}
      });
    }
    input.reason = input.reason.trim();
  }

  private async createCommand(
    data: Prisma.OperationalCommandUncheckedCreateInput
  ) {
    try {
      const command = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.operationalCommand.create({ data });
        const payload: ExecuteOperationalCommandPayload = {
          operationalCommandId: created.id
        };
        await this.jobs.enqueue(EXECUTE_OPERATIONAL_COMMAND_JOB, payload, {
          aggregateType: "operational_command",
          aggregateId: created.id,
          client: transaction,
          deduplicationKey: `operational-command:${created.id}`,
          maxAttempts: 5
        });
        return created;
      });
      return this.toDto(command);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.operationalCommand.findUnique({
          where: { idempotencyKey: data.idempotencyKey }
        });
        if (existing) return this.toDto(existing);
      }
      throw error;
    }
  }

  private async existingOrConflict(input: {
    commandType: OperationalCommandType;
    idempotencyKey: string;
    targetId: string | null;
    reason: string;
    requestedById: string | null;
  }) {
    const existing = await this.prisma.operationalCommand.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (!existing) return null;
    if (
      existing.commandType !== input.commandType ||
      existing.targetId !== input.targetId ||
      existing.reason !== input.reason ||
      existing.requestedById !== input.requestedById
    ) {
      throw new ConflictException({
        code: "OPERATIONAL_IDEMPOTENCY_CONFLICT",
        message: "The idempotency key was already used for a different command.",
        details: {}
      });
    }
    return existing;
  }

  private async requireAdmin(token: string) {
    const user = await this.auth.getCurrentUserRecord(token);
    if (!user.roles.includes(UserRole.admin)) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only administrators can execute operational commands.",
        details: {}
      });
    }
    return user;
  }

  private toDto(command: {
    id: string;
    commandType: OperationalCommandType;
    source: OperationalCommandSource;
    targetId: string | null;
    status: OperationalCommandStatus;
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
      id: command.id,
      commandType: command.commandType,
      source: command.source,
      targetId: command.targetId,
      status: command.status,
      batchLimit: command.batchLimit,
      staleBefore: command.staleBefore?.toISOString() ?? null,
      counts: {
        scanned: command.scannedCount,
        succeeded: command.succeededCount,
        skipped: command.skippedCount,
        retryableFailures: command.retryableFailureCount,
        permanentFailures: command.permanentFailureCount,
        providerCalls: command.providerCallCount
      },
      resultCode: command.resultCode,
      lastFailureCategory: command.lastFailureCategory,
      startedAt: command.startedAt?.toISOString() ?? null,
      completedAt: command.completedAt?.toISOString() ?? null,
      createdAt: command.createdAt.toISOString(),
      updatedAt: command.updatedAt.toISOString()
    };
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
  }

  private notRequeueable() {
    return new UnprocessableEntityException({
      code: "JOB_EXECUTION_NOT_REQUEUEABLE",
      message: "Only retryable failed executions on known queues can be requeued.",
      details: {}
    });
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "The operational command was not found.",
      details: {}
    });
  }
}
