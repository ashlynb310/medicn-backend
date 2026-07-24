import {
  OperationalCommandSource,
  OperationalCommandStatus,
  OperationalCommandType,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { JobsService } from "../src/jobs/jobs.service";
import type { FinancialReconciliationService } from "../src/payments/financial-reconciliation.service";
import type { JobRecoveryService } from "../src/operations/job-recovery.service";
import { OperationalCommandsService } from "../src/operations/operational-commands.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("financial operations PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let prisma: PrismaService;
  let adminId = "";
  let service: OperationalCommandsService;
  const reconciliation = {
    reconcilePayments: jest.fn(),
    reconcileHostTransfers: jest.fn()
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const admin = await prisma.user.create({
      data: {
        supabaseUserId: `financial-ops-admin-${suffix}`,
        email: `financial-ops-admin-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.admin]
      }
    });
    adminId = admin.id;
    service = new OperationalCommandsService(
      prisma,
      {
        getCurrentUserRecord: jest.fn().mockResolvedValue(admin)
      } as unknown as AuthService,
      new JobsService(prisma),
      { requeue: jest.fn() } as unknown as JobRecoveryService,
      reconciliation as unknown as FinancialReconciliationService
    );
  });

  afterAll(async () => {
    if (prisma) {
      const commands = await prisma.operationalCommand.findMany({
        where: { idempotencyKey: { startsWith: `integration:${suffix}:` } },
        select: { id: true }
      });
      const ids = commands.map((command) => command.id);
      await prisma.jobExecution.deleteMany({
        where: { aggregateType: "operational_command", aggregateId: { in: ids } }
      });
      await prisma.outboxEvent.deleteMany({
        where: { aggregateType: "operational_command", aggregateId: { in: ids } }
      });
      await prisma.operationalCommand.deleteMany({ where: { id: { in: ids } } });
      if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
      await prisma.$disconnect();
    }
  });

  it("creates one audited command and one opaque Outbox row under concurrent idempotent requests", async () => {
    const idempotencyKey = `integration:${suffix}:concurrent`;
    const input = {
      idempotencyKey,
      reason: "Reconcile a bounded stale batch after operator inspection.",
      limit: 2
    };
    const [first, second] = await Promise.all([
      service.queuePaymentReconciliation("token", input),
      service.queuePaymentReconciliation("token", input)
    ]);

    expect(first.id).toBe(second.id);
    await expect(
      prisma.operationalCommand.count({ where: { idempotencyKey } })
    ).resolves.toBe(1);
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateType: "operational_command", aggregateId: first.id }
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ operationalCommandId: first.id });
    expect(JSON.stringify(events[0]?.payload)).not.toMatch(
      /reason|stripe|payment|email|address|token/i
    );
  });

  it("rolls back the command when transactional Outbox creation fails", async () => {
    const idempotencyKey = `integration:${suffix}:rollback`;
    const failing = new OperationalCommandsService(
      prisma,
      {
        getCurrentUserRecord: jest.fn().mockResolvedValue({
          id: adminId,
          roles: [UserRole.admin]
        })
      } as unknown as AuthService,
      { enqueue: jest.fn().mockRejectedValue(new Error("injected")) } as never,
      { requeue: jest.fn() } as unknown as JobRecoveryService,
      reconciliation as unknown as FinancialReconciliationService
    );

    await expect(
      failing.queuePaymentReconciliation("token", {
        idempotencyKey,
        reason: "Verify command and Outbox atomicity under injected failure.",
        limit: 1
      })
    ).rejects.toThrow();
    await expect(
      prisma.operationalCommand.count({ where: { idempotencyKey } })
    ).resolves.toBe(0);
  });

  it("claims one reconciliation execution under concurrent workers", async () => {
    const created = await prisma.operationalCommand.create({
      data: {
        commandType: OperationalCommandType.payment_reconciliation,
        source: OperationalCommandSource.admin_api,
        idempotencyKey: `integration:${suffix}:worker-race`,
        requestedById: adminId,
        reason: "Verify concurrent reconciliation worker claim serialization.",
        batchLimit: 1,
        staleBefore: new Date(Date.now() - 60_000)
      }
    });
    reconciliation.reconcilePayments.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        scanned: 0,
        succeeded: 0,
        skipped: 0,
        retryableFailures: 0,
        permanentFailures: 0,
        providerCalls: 0,
        lastFailureCategory: null
      };
    });

    await Promise.all([service.execute(created.id), service.execute(created.id)]);
    expect(reconciliation.reconcilePayments).toHaveBeenCalledTimes(1);
    await expect(
      prisma.operationalCommand.findUnique({ where: { id: created.id } })
    ).resolves.toMatchObject({
      status: OperationalCommandStatus.succeeded,
      resultCode: "NO_STALE_CANDIDATES"
    });
  });
});
