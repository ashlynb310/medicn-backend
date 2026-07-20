import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import {
  JobExecutionState,
  OperationalCommandSource,
  OperationalCommandStatus,
  OperationalCommandType,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { JobsService } from "../src/jobs/jobs.service";
import type { JobRecoveryService } from "../src/operations/job-recovery.service";
import { OperationalCommandsService } from "../src/operations/operational-commands.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import type { FinancialReconciliationService } from "../src/payments/financial-reconciliation.service";

const now = new Date("2026-07-19T12:00:00.000Z");
const admin = { id: "admin-1", roles: [UserRole.admin] };

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    commandType: OperationalCommandType.job_requeue,
    source: OperationalCommandSource.admin_api,
    idempotencyKey: "job:requeue:execution-1",
    requestedById: admin.id,
    targetId: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    reason: "Retry a transient Redis failure after inspection.",
    status: OperationalCommandStatus.queued,
    batchLimit: null,
    staleBefore: null,
    scannedCount: 0,
    succeededCount: 0,
    skippedCount: 0,
    retryableFailureCount: 0,
    permanentFailureCount: 0,
    providerCallCount: 0,
    resultCode: null,
    lastFailureCategory: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createService(user: { id: string; roles: UserRole[] } = admin) {
  const stores = {
    jobExecution: { findUnique: jest.fn() },
    operationalCommand: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    }
  };
  type MockPrisma = typeof stores & { $transaction: jest.Mock };
  const prisma: MockPrisma = {
    ...stores,
    $transaction: jest.fn(
      async (callback: (client: MockPrisma) => Promise<unknown>) => callback(prisma)
    )
  };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(user) };
  const jobs = { enqueue: jest.fn() };
  const recovery = { requeue: jest.fn() };
  const reconciliation = {
    reconcilePayments: jest.fn(),
    reconcileHostTransfers: jest.fn()
  };
  return {
    prisma,
    jobs,
    recovery,
    reconciliation,
    service: new OperationalCommandsService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthService,
      jobs as unknown as JobsService,
      recovery as unknown as JobRecoveryService,
      reconciliation as unknown as FinancialReconciliationService
    )
  };
}

describe("OperationalCommandsService", () => {
  it("rejects non-Admin command creation", async () => {
    const { service, jobs } = createService({ id: "renter-1", roles: [UserRole.renter] });
    await expect(service.queueJobRequeue("token", command().targetId!, {
      idempotencyKey: "job:requeue:execution-1",
      reason: "Retry a transient Redis failure after inspection."
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("rejects active, completed, permanent, and unknown-queue executions", async () => {
    const { service, prisma } = createService();
    for (const candidate of [
      { state: JobExecutionState.running, retryable: null, queueName: "operations" },
      { state: JobExecutionState.succeeded, retryable: false, queueName: "operations" },
      { state: JobExecutionState.failed, retryable: false, queueName: "operations" },
      { state: JobExecutionState.failed, retryable: true, queueName: "attacker" }
    ]) {
      prisma.jobExecution.findUnique.mockResolvedValueOnce({ id: command().targetId, ...candidate });
      await expect(service.queueJobRequeue("token", command().targetId!, {
        idempotencyKey: `job:requeue:${candidate.state}:${candidate.queueName}`,
        reason: "Retry only after an administrator inspected the failure."
      })).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it("atomically records an audited requeue command and opaque Outbox job", async () => {
    const { service, prisma, jobs } = createService();
    prisma.operationalCommand.findUnique.mockResolvedValue(null);
    prisma.jobExecution.findUnique.mockResolvedValue({
      id: command().targetId,
      state: JobExecutionState.failed,
      retryable: true,
      queueName: "operations"
    });
    prisma.operationalCommand.create.mockResolvedValue(command());

    const result = await service.queueJobRequeue("token", command().targetId!, {
      idempotencyKey: command().idempotencyKey,
      reason: command().reason
    });
    expect(result).toMatchObject({ id: command().id, status: "queued" });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "execute_operational_command",
      { operationalCommandId: command().id },
      expect.objectContaining({
        aggregateType: "operational_command",
        aggregateId: command().id,
        client: prisma
      })
    );
    expect(JSON.stringify(jobs.enqueue.mock.calls[0])).not.toMatch(/reason|queueName|payload/);
  });

  it("returns the original command for an identical idempotency key", async () => {
    const { service, prisma, jobs } = createService();
    prisma.operationalCommand.findUnique.mockResolvedValue(command());
    const result = await service.queueJobRequeue("token", command().targetId!, {
      idempotencyKey: command().idempotencyKey,
      reason: command().reason
    });
    expect(result.id).toBe(command().id);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key for different intent", async () => {
    const { service, prisma } = createService();
    prisma.operationalCommand.findUnique.mockResolvedValue(command({ targetId: "different" }));
    await expect(service.queueJobRequeue("token", command().targetId!, {
      idempotencyKey: command().idempotencyKey,
      reason: command().reason
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("executes requeue through the existing recovery service and records success", async () => {
    const { service, prisma, recovery } = createService();
    prisma.operationalCommand.findUnique
      .mockResolvedValueOnce(command())
      .mockResolvedValueOnce(command({ status: OperationalCommandStatus.running }));
    prisma.operationalCommand.updateMany.mockResolvedValue({ count: 1 });
    prisma.jobExecution.findUnique.mockResolvedValue({
      state: JobExecutionState.failed,
      retryable: true,
      queueName: "operations"
    });
    prisma.operationalCommand.update.mockResolvedValue(command({
      status: OperationalCommandStatus.succeeded,
      scannedCount: 1,
      succeededCount: 1,
      resultCode: "bullmq_retry"
    }));
    recovery.requeue.mockResolvedValue({
      action: "bullmq_retry",
      queue: "operations",
      jobId: "job-1"
    });

    await expect(service.execute(command().id)).resolves.toMatchObject({
      status: OperationalCommandStatus.succeeded,
      resultCode: "bullmq_retry"
    });
    expect(recovery.requeue).toHaveBeenCalledWith(command().targetId);
  });

  it("records bounded reconciliation outcomes without persisting provider data", async () => {
    const { service, prisma, reconciliation } = createService();
    const queued = command({
      commandType: OperationalCommandType.payment_reconciliation,
      targetId: null,
      batchLimit: 10,
      staleBefore: new Date(now.getTime() - 60_000)
    });
    prisma.operationalCommand.findUnique
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce({
        ...queued,
        status: OperationalCommandStatus.running
      });
    prisma.operationalCommand.updateMany.mockResolvedValue({ count: 1 });
    reconciliation.reconcilePayments.mockResolvedValue({
      scanned: 2,
      succeeded: 1,
      skipped: 1,
      retryableFailures: 0,
      permanentFailures: 0,
      providerCalls: 1,
      lastFailureCategory: null
    });
    prisma.operationalCommand.update.mockResolvedValue({
      ...queued,
      status: OperationalCommandStatus.succeeded,
      scannedCount: 2,
      succeededCount: 1,
      skippedCount: 1,
      providerCallCount: 1,
      resultCode: "RECONCILIATION_SUCCEEDED",
      completedAt: now
    });

    await expect(service.execute(queued.id)).resolves.toMatchObject({
      status: OperationalCommandStatus.succeeded,
      counts: { scanned: 2, succeeded: 1, skipped: 1, providerCalls: 1 }
    });
    expect(reconciliation.reconcilePayments).toHaveBeenCalledWith({
      commandId: queued.id,
      targetId: null,
      limit: 10,
      staleBefore: queued.staleBefore
    });
    expect(prisma.operationalCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          providerPayload: expect.anything(),
          rawError: expect.anything()
        })
      })
    );
  });
});
