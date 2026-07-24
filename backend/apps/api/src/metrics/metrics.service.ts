import { Injectable } from "@nestjs/common";
import {
  EmailWebhookProcessingStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  JobExecutionState,
  OperationalCommandType,
  OutboxEventStatus,
  PaymentStatus
} from "@prisma/client";
import { Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { QueueObservabilityService } from "../operations/queue-observability.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";

const KNOWN_OPERATIONS = new Set([
  "send_transactional_email", "process_media_asset", "cleanup_media_asset",
  "enrich_listing_location", "stripe_webhook_retry", "checkout_expiry",
  "host_transfer_release", "veriff_webhook_retry", "media_recovery",
  "media_cleanup", "maps_recovery", "maps_refresh", "brevo_webhook_retry",
  "stale_operational_recovery", "requested_booking_expiry",
  "booking_completion", "execute_operational_command"
]);

@Injectable()
export class MetricsService {
  readonly contentType: string;
  private readonly registry = new Registry();
  private readonly queueJobs = this.gauge("medicn_queue_jobs", "BullMQ jobs by bounded queue and state.", ["queue", "state"]);
  private readonly outboxEvents = this.gauge("medicn_outbox_events", "Outbox events by state.", ["state"]);
  private readonly outboxOldest = this.gauge("medicn_outbox_oldest_pending_age_seconds", "Age of the oldest publishable outbox event.");
  private readonly outboxStaleClaims = this.gauge("medicn_outbox_stale_claims", "Expired outbox publication claims.");
  private readonly executions = this.gauge("medicn_job_executions", "Durable job executions by queue and state.", ["queue", "state", "retryable"]);
  private readonly webhookBacklog = this.gauge("medicn_email_webhook_events", "Email webhook inbox events by state.", ["state"]);
  private readonly suppressions = this.gauge("medicn_email_recipient_suppressions", "Active recipient suppressions by reason.", ["reason"]);
  private readonly heartbeatAge = this.gauge("medicn_worker_heartbeat_age_seconds", "Age of the newest heartbeat by worker process.", ["process"]);
  private readonly staleWorkers = this.gauge("medicn_worker_stale_instances", "Worker instances older than the heartbeat threshold.", ["process"]);
  private readonly transferFailures = this.gauge("medicn_host_transfer_failures", "Host transfers requiring operational attention by state.", ["state"]);
  private readonly providerDuration = this.gauge("medicn_provider_operation_duration_seconds", "Recent average durable operation duration.", ["operation"]);
  private readonly providerErrorRate = this.gauge("medicn_provider_operation_error_ratio", "Recent durable operation error ratio.", ["operation"]);
  private readonly queueObservation = this.gauge("medicn_queue_observation_up", "Whether Redis queue observation succeeded.");
  private readonly operationalCommands = this.gauge("medicn_operational_commands", "Durable inspection, requeue, and reconciliation commands by bounded type and status.", ["type", "status"]);
  private readonly reconciliationOutcomes = this.gauge("medicn_reconciliation_outcomes", "Recent durable reconciliation candidate outcomes.", ["type", "outcome"]);
  private readonly reconciliationProviderFailures = this.gauge("medicn_reconciliation_provider_failures", "Recent sanitized provider failures observed by reconciliation.", ["type", "retryable"]);
  private readonly staleFinancialRecords = this.gauge("medicn_reconciliation_stale_records", "Stale non-terminal financial records eligible for explicit reconciliation.", ["resource"]);
  private readonly reconciliationLag = this.gauge("medicn_reconciliation_lag_seconds", "Age of the oldest stale financial reconciliation candidate.", ["resource"]);
  private readonly jobInspectionCandidates = this.gauge("medicn_job_inspection_candidates", "Failed durable jobs visible to inspection by eligibility.", ["result"]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueObservabilityService,
    private readonly config: ConfigService
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: "medicn_node_" });
    this.contentType = this.registry.contentType;
  }

  async render() {
    await this.collectDurableMetrics();
    return this.registry.metrics();
  }

  private async collectDurableMetrics() {
    const now = new Date();
    const recent = new Date(now.getTime() - 3_600_000);
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    const [outbox, oldest, staleClaims, executions, webhooks, suppressions, heartbeats, transfers, recentExecutions, commands, stalePayments, staleTransfers, oldestStalePayment, oldestStaleTransfer] = await Promise.all([
      this.prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.outboxEvent.findFirst({ where: { status: OutboxEventStatus.pending }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      this.prisma.outboxEvent.count({ where: { status: OutboxEventStatus.publishing, claimExpiresAt: { lte: now } } }),
      this.prisma.jobExecution.groupBy({ by: ["queueName", "state", "retryable"], _count: { _all: true } }),
      this.prisma.emailWebhookEvent.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.recipientSuppression.groupBy({ by: ["reason"], where: { active: true }, _count: { _all: true } }),
      this.prisma.workerHeartbeat.findMany({ select: { processType: true, lastHeartbeatAt: true }, orderBy: { lastHeartbeatAt: "desc" }, take: 100 }),
      this.prisma.hostTransfer.groupBy({ by: ["status"], where: { status: { in: ["failed", "blocked"] } }, _count: { _all: true } }),
      this.prisma.jobExecution.findMany({
        where: { startedAt: { gte: recent }, state: { in: [JobExecutionState.succeeded, JobExecutionState.failed] } },
        select: { jobType: true, state: true, startedAt: true, completedAt: true },
        take: 2_000
      }),
      this.prisma.operationalCommand.findMany({
        where: { createdAt: { gte: recent } },
        select: {
          commandType: true, status: true, succeededCount: true, skippedCount: true,
          retryableFailureCount: true, permanentFailureCount: true
        },
        orderBy: { createdAt: "desc" },
        take: 2_000
      }),
      this.prisma.payment.count({
        where: {
          updatedAt: { lte: staleBefore },
          status: { in: [PaymentStatus.pending, PaymentStatus.failed, PaymentStatus.expired, PaymentStatus.paid, PaymentStatus.partially_refunded, PaymentStatus.disputed] },
          OR: [{ providerPaymentIntentId: { not: null } }, { providerCheckoutSessionId: { not: null } }]
        }
      }),
      this.prisma.hostTransfer.count({
        where: {
          updatedAt: { lte: staleBefore },
          OR: [
            { status: { in: [HostTransferStatus.pending, HostTransferStatus.processing, HostTransferStatus.failed] } },
            { reversalStatus: { in: [HostTransferReversalStatus.pending, HostTransferReversalStatus.processing, HostTransferReversalStatus.partially_reversed, HostTransferReversalStatus.failed] } }
          ]
        }
      }),
      this.prisma.payment.findFirst({
        where: {
          updatedAt: { lte: staleBefore },
          status: { in: [PaymentStatus.pending, PaymentStatus.failed, PaymentStatus.expired, PaymentStatus.paid, PaymentStatus.partially_refunded, PaymentStatus.disputed] },
          OR: [{ providerPaymentIntentId: { not: null } }, { providerCheckoutSessionId: { not: null } }]
        },
        orderBy: { updatedAt: "asc" },
        select: { updatedAt: true }
      }),
      this.prisma.hostTransfer.findFirst({
        where: {
          updatedAt: { lte: staleBefore },
          OR: [
            { status: { in: [HostTransferStatus.pending, HostTransferStatus.processing, HostTransferStatus.failed] } },
            { reversalStatus: { in: [HostTransferReversalStatus.pending, HostTransferReversalStatus.processing, HostTransferReversalStatus.partially_reversed, HostTransferReversalStatus.failed] } }
          ]
        },
        orderBy: { updatedAt: "asc" },
        select: { updatedAt: true }
      })
    ]);

    this.outboxEvents.reset();
    for (const row of outbox) this.outboxEvents.set({ state: row.status }, row._count._all);
    this.outboxOldest.set(oldest ? Math.max(0, (now.getTime() - oldest.createdAt.getTime()) / 1000) : 0);
    this.outboxStaleClaims.set(staleClaims);
    this.executions.reset();
    for (const row of executions) this.executions.set({ queue: this.safeLabel(row.queueName), state: row.state, retryable: String(row.retryable ?? "unknown") }, row._count._all);
    this.jobInspectionCandidates.reset();
    this.jobInspectionCandidates.set({ result: "eligible" }, executions.filter((row) => row.state === JobExecutionState.failed && row.retryable === true).reduce((sum, row) => sum + row._count._all, 0));
    this.jobInspectionCandidates.set({ result: "dead_letter" }, executions.filter((row) => row.state === JobExecutionState.failed && row.retryable === false).reduce((sum, row) => sum + row._count._all, 0));
    this.webhookBacklog.reset();
    for (const row of webhooks) this.webhookBacklog.set({ state: row.status }, row._count._all);
    for (const status of [EmailWebhookProcessingStatus.failed, EmailWebhookProcessingStatus.unmatched]) {
      if (!webhooks.some((row) => row.status === status)) this.webhookBacklog.set({ state: status }, 0);
    }
    this.suppressions.reset();
    for (const row of suppressions) this.suppressions.set({ reason: row.reason }, row._count._all);
    this.heartbeatAge.reset();
    this.staleWorkers.reset();
    const newest = new Map<string, Date>();
    const heartbeatStaleBefore = now.getTime() - (this.config.get<number>("WORKER_HEARTBEAT_STALE_MS") ?? 60_000);
    const staleByProcess = new Map<string, number>();
    for (const heartbeat of heartbeats) {
      if (!newest.has(heartbeat.processType)) newest.set(heartbeat.processType, heartbeat.lastHeartbeatAt);
      if (heartbeat.lastHeartbeatAt.getTime() < heartbeatStaleBefore) {
        staleByProcess.set(heartbeat.processType, (staleByProcess.get(heartbeat.processType) ?? 0) + 1);
      }
    }
    for (const [processType, last] of newest) this.heartbeatAge.set({ process: processType }, Math.max(0, (now.getTime() - last.getTime()) / 1000));
    for (const [processType, count] of staleByProcess) this.staleWorkers.set({ process: processType }, count);
    this.transferFailures.reset();
    for (const row of transfers) this.transferFailures.set({ state: row.status }, row._count._all);

    this.operationalCommands.reset();
    this.reconciliationOutcomes.reset();
    this.reconciliationProviderFailures.reset();
    const commandCounts = new Map<string, number>();
    const outcomeCounts = new Map<string, number>();
    for (const command of commands) {
      const commandKey = `${command.commandType}:${command.status}`;
      commandCounts.set(commandKey, (commandCounts.get(commandKey) ?? 0) + 1);
      if (command.commandType !== OperationalCommandType.job_requeue) {
        const values = {
          succeeded: command.succeededCount,
          skipped: command.skippedCount,
          retryable_failure: command.retryableFailureCount,
          permanent_failure: command.permanentFailureCount
        };
        for (const [outcome, count] of Object.entries(values)) {
          const key = `${command.commandType}:${outcome}`;
          outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + count);
        }
        this.reconciliationProviderFailures.set(
          { type: command.commandType, retryable: "true" },
          (outcomeCounts.get(`${command.commandType}:retryable_failure`) ?? 0)
        );
        this.reconciliationProviderFailures.set(
          { type: command.commandType, retryable: "false" },
          (outcomeCounts.get(`${command.commandType}:permanent_failure`) ?? 0)
        );
      }
    }
    for (const [key, count] of commandCounts) {
      const [type, status] = key.split(":");
      this.operationalCommands.set({ type, status }, count);
    }
    for (const [key, count] of outcomeCounts) {
      const separator = key.indexOf(":");
      this.reconciliationOutcomes.set({ type: key.slice(0, separator), outcome: key.slice(separator + 1) }, count);
    }
    this.staleFinancialRecords.set({ resource: "payment" }, stalePayments);
    this.staleFinancialRecords.set({ resource: "host_transfer" }, staleTransfers);
    this.reconciliationLag.set({ resource: "payment" }, oldestStalePayment ? Math.max(0, (now.getTime() - oldestStalePayment.updatedAt.getTime()) / 1000) : 0);
    this.reconciliationLag.set({ resource: "host_transfer" }, oldestStaleTransfer ? Math.max(0, (now.getTime() - oldestStaleTransfer.updatedAt.getTime()) / 1000) : 0);

    const operationStats = new Map<string, { total: number; failed: number; duration: number; completed: number }>();
    for (const execution of recentExecutions) {
      const operation = KNOWN_OPERATIONS.has(execution.jobType) ? execution.jobType : "other";
      const stats = operationStats.get(operation) ?? { total: 0, failed: 0, duration: 0, completed: 0 };
      stats.total += 1;
      if (execution.state === JobExecutionState.failed) stats.failed += 1;
      if (execution.completedAt) {
        stats.duration += Math.max(0, execution.completedAt.getTime() - execution.startedAt.getTime()) / 1000;
        stats.completed += 1;
      }
      operationStats.set(operation, stats);
    }
    this.providerDuration.reset();
    this.providerErrorRate.reset();
    for (const [operation, stats] of operationStats) {
      this.providerDuration.set({ operation }, stats.completed ? stats.duration / stats.completed : 0);
      this.providerErrorRate.set({ operation }, stats.total ? stats.failed / stats.total : 0);
    }

    try {
      const queues = await this.queues.snapshot();
      this.queueJobs.reset();
      for (const queue of queues) for (const [state, count] of Object.entries(queue.counts)) this.queueJobs.set({ queue: queue.name, state }, count);
      this.queueObservation.set(1);
    } catch {
      this.queueObservation.set(0);
    }
  }

  private gauge(name: string, help: string, labelNames: string[] = []) {
    return new Gauge({ name, help, labelNames, registers: [this.registry] });
  }

  private safeLabel(value: string) {
    return ["email", "media", "maps", "operations"].includes(value) ? value : "other";
  }
}
