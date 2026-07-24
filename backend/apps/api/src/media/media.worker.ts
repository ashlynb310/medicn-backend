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
import { MediaProcessingService } from "./media-processing.service";
import { HealthcareEvidenceDeletionService } from "../healthcare/healthcare-evidence-deletion.service";
import {
  DELETE_HEALTHCARE_EVIDENCE_JOB,
  type DeleteHealthcareEvidencePayload
} from "../healthcare/healthcare.types";
import {
  CLEANUP_MEDIA_ASSET_JOB,
  MEDIA_QUEUE_NAME,
  PROCESS_MEDIA_ASSET_JOB,
  type CleanupMediaAssetPayload,
  type ProcessMediaAssetPayload
} from "./media.types";

async function bootstrap() {
  const logger = new Logger("MediaWorker");
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const media = app.get(MediaProcessingService);
  const healthcareDeletion = app.get(HealthcareEvidenceDeletionService);
  const executions = app.get(JobExecutionService);
  const identity = createWorkerIdentity(WorkerProcessType.media);
  const stopHeartbeat = startWorkerHeartbeat(app.get(WorkerHeartbeatService), config, WorkerProcessType.media, identity, logger);
  const connection = redisConnectionFromConfig(config, "worker");
  const concurrency = config.get<number>("MEDIA_PROCESSING_CONCURRENCY") ?? 2;

  const worker = new Worker(MEDIA_QUEUE_NAME, async (job) => {
    await executions.run({ queueName: MEDIA_QUEUE_NAME, jobType: job.name, jobId: String(job.id), outboxEventId: String(job.id), attemptNumber: job.attemptsMade + 1, workerIdentity: identity }, async () => {
      if (job.name === PROCESS_MEDIA_ASSET_JOB) await media.process((job.data as ProcessMediaAssetPayload).assetId);
      else if (job.name === CLEANUP_MEDIA_ASSET_JOB) await media.cleanup((job.data as CleanupMediaAssetPayload).assetId);
      else if (job.name === DELETE_HEALTHCARE_EVIDENCE_JOB) {
        await healthcareDeletion.deleteSubmission(
          (job.data as DeleteHealthcareEvidencePayload).healthcareVerificationId
        );
      }
      else throw new Error("Unsupported media job type.");
      return { value: undefined };
    });
  }, { connection, concurrency, prefix: bullMqPrefix(config) });
  attachSafeWorkerListeners(worker, logger);
  logger.log(`worker_started process=media queue=${MEDIA_QUEUE_NAME} concurrency=${concurrency}`);

  const shutdown = async () => {
    stopHeartbeat();
    await closeWorkerBounded(worker, logger);
    await app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void bootstrap().catch(() => {
  process.stderr.write("media_worker_startup_failed\n");
  process.exitCode = 1;
});
