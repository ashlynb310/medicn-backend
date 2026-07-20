import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Worker } from "bullmq";
import { WorkerProcessType } from "@prisma/client";
import { AppModule } from "../app.module";
import { JobExecutionService } from "../jobs/job-execution.service";
import { bullMqPrefix, redisConnectionFromConfig } from "../jobs/redis";
import { WorkerHeartbeatService } from "../jobs/worker-heartbeat.service";
import { attachSafeWorkerListeners, closeWorkerBounded, createWorkerIdentity, startWorkerHeartbeat } from "../jobs/worker-runtime";
import { OperationsQueueService } from "./operations-queue.service";
import { OperationsService } from "./operations.service";
import { OPERATION_JOB_NAMES, OPERATIONS_QUEUE_NAME, type OperationJobName } from "./operations.types";

const knownNames = new Set<string>(Object.values(OPERATION_JOB_NAMES));

async function bootstrap() {
  const logger = new Logger("OperationsWorker");
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const operations = app.get(OperationsService);
  const executions = app.get(JobExecutionService);
  const identity = createWorkerIdentity(WorkerProcessType.operations);
  const stopHeartbeat = startWorkerHeartbeat(app.get(WorkerHeartbeatService), config, WorkerProcessType.operations, identity, logger);
  if (config.get<boolean>("OPERATIONS_SCHEDULER_ENABLED")) {
    await app.get(OperationsQueueService).upsertSchedulers();
  }
  const worker = new Worker(OPERATIONS_QUEUE_NAME, async (job) => {
    if (!knownNames.has(job.name)) throw new Error("Unsupported operations job type.");
    await executions.run({
      queueName: OPERATIONS_QUEUE_NAME,
      jobType: job.name,
      jobId: String(job.id),
      attemptNumber: job.attemptsMade + 1,
      workerIdentity: identity
    }, async () => ({ value: await operations.run(job.name as OperationJobName, job.data) }));
  }, {
    connection: redisConnectionFromConfig(config, "worker"),
    prefix: bullMqPrefix(config),
    concurrency: 2
  });
  attachSafeWorkerListeners(worker, logger);
  logger.log(`worker_started process=operations queue=${OPERATIONS_QUEUE_NAME}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    stopHeartbeat();
    await closeWorkerBounded(worker, logger);
    await app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void bootstrap().catch(() => {
  process.stderr.write("operations_worker_startup_failed\n");
  process.exitCode = 1;
});
