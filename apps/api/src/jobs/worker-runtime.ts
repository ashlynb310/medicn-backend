import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Worker } from "bullmq";
import { WorkerProcessType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { WorkerHeartbeatService } from "./worker-heartbeat.service";

export function createWorkerIdentity(processType: WorkerProcessType) {
  return `${processType}-${hostname().slice(0, 30)}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

export function startWorkerHeartbeat(
  heartbeats: WorkerHeartbeatService,
  config: Pick<ConfigService, "get">,
  processType: WorkerProcessType,
  instanceId: string,
  logger: Logger
) {
  const startedAt = new Date();
  const intervalMs = config.get<number>("WORKER_HEARTBEAT_INTERVAL_MS") ?? 15_000;
  const beat = () => heartbeats
    .beat(processType, instanceId, startedAt, process.env.npm_package_version ?? "0.1.0")
    .catch(() => logger.warn(`heartbeat_failed process=${processType}`));
  void beat();
  const interval = setInterval(() => void beat(), intervalMs);
  interval.unref();
  return () => clearInterval(interval);
}

export function attachSafeWorkerListeners(worker: Worker, logger: Logger) {
  worker.on("completed", (job) => {
    logger.log(`job_completed queue=${worker.name} type=${job.name} id=${shortId(job.id)}`);
  });
  worker.on("failed", (job) => {
    logger.warn(`job_failed queue=${worker.name} type=${job?.name ?? "unknown"} id=${shortId(job?.id)}`);
  });
  worker.on("stalled", (jobId) => {
    logger.warn(`job_stalled queue=${worker.name} id=${shortId(jobId)}`);
  });
  worker.on("error", () => {
    logger.error(`worker_error queue=${worker.name}`);
  });
}

export async function closeWorkerBounded(worker: Worker, logger: Logger, timeoutMs = 30_000) {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    worker.close(),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
      timer.unref();
    })
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    logger.warn(`worker_shutdown_forced queue=${worker.name}`);
    await worker.close(true);
  }
}

function shortId(id: string | undefined | null) {
  return id?.slice(0, 12) ?? "unknown";
}
