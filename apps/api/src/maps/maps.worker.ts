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
import { LocationService } from "./location.service";
import { ENRICH_LISTING_LOCATION_JOB, MAPS_QUEUE_NAME } from "./maps.types";

async function bootstrap() {
  const logger = new Logger("MapsWorker");
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const locations = app.get(LocationService);
  const executions = app.get(JobExecutionService);
  const identity = createWorkerIdentity(WorkerProcessType.maps);
  const stopHeartbeat = startWorkerHeartbeat(app.get(WorkerHeartbeatService), config, WorkerProcessType.maps, identity, logger);
  const connection = redisConnectionFromConfig(config, "worker");
  const concurrency = config.get<number>("MAPS_WORKER_CONCURRENCY") ?? 2;
  const worker = new Worker(MAPS_QUEUE_NAME, async (job) => {
    await executions.run({ queueName: MAPS_QUEUE_NAME, jobType: job.name, jobId: String(job.id), outboxEventId: String(job.id), attemptNumber: job.attemptsMade + 1, workerIdentity: identity }, async () => {
      if (job.name !== ENRICH_LISTING_LOCATION_JOB) throw new Error("Unsupported maps job type.");
      const payload = job.data as { listingId?: unknown; addressVersion?: unknown };
      if (typeof payload.listingId !== "string" || !Number.isInteger(payload.addressVersion)) throw new Error("Invalid maps job payload.");
      await locations.enrichListing(payload.listingId, payload.addressVersion as number);
      return { value: undefined };
    });
  }, { connection, concurrency, prefix: bullMqPrefix(config) });
  attachSafeWorkerListeners(worker, logger);
  logger.log(`worker_started process=maps queue=${MAPS_QUEUE_NAME} concurrency=${concurrency}`);
  const shutdown = async () => {
    stopHeartbeat();
    await closeWorkerBounded(worker, logger);
    await app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
void bootstrap().catch(() => {
  process.stderr.write("maps_worker_startup_failed\n");
  process.exitCode = 1;
});
