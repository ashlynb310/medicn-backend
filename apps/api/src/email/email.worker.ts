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
import { EMAIL_QUEUE_NAME, type TransactionalEmailPayload } from "./email.types";
import { EmailService } from "./email.service";
import {
  MESSAGING_NOTIFICATION_EMAIL_JOB,
  type MessagingNotificationEmailPayload
} from "../messaging/messaging.types";
import {
  BOOKING_CANCELLATION_EMAIL_JOB,
  type BookingCancellationEmailPayload
} from "../bookings/booking-cancellation.types";
import {
  BOOKING_COMPLETION_EMAIL_JOB,
  type BookingCompletionEmailPayload
} from "../bookings/booking-lifecycle.types";

async function bootstrap() {
  const logger = new Logger("EmailWorker");
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const email = app.get(EmailService);
  const executions = app.get(JobExecutionService);
  const identity = createWorkerIdentity(WorkerProcessType.email);
  const stopHeartbeat = startWorkerHeartbeat(app.get(WorkerHeartbeatService), config, WorkerProcessType.email, identity, logger);
  const connection = redisConnectionFromConfig(config, "worker");

  const worker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job) => {
      await executions.run({
        queueName: EMAIL_QUEUE_NAME,
        jobType: job.name,
        jobId: String(job.id),
        outboxEventId: String(job.id),
        attemptNumber: job.attemptsMade + 1,
        workerIdentity: identity
      }, async () => {
        const result = job.name === MESSAGING_NOTIFICATION_EMAIL_JOB
          ? await email.sendMessagingNotificationNow(
              job.data as MessagingNotificationEmailPayload,
              { outboxEventId: String(job.id) }
            )
          : job.name === BOOKING_CANCELLATION_EMAIL_JOB
          ? await email.sendBookingCancellationNow(
              job.data as BookingCancellationEmailPayload,
              { outboxEventId: String(job.id) }
            )
          : job.name === BOOKING_COMPLETION_EMAIL_JOB
          ? await email.sendBookingCompletionNow(
              job.data as BookingCompletionEmailPayload,
              { outboxEventId: String(job.id) }
            )
          : await email.sendNow(job.data as TransactionalEmailPayload, {
              outboxEventId: String(job.id)
            });
        return { value: undefined, providerRef: result.messageId };
      });
    },
    { connection, prefix: bullMqPrefix(config) }
  );
  attachSafeWorkerListeners(worker, logger);
  logger.log(`worker_started process=email queue=${EMAIL_QUEUE_NAME}`);

  const shutdown = async () => {
    stopHeartbeat();
    await closeWorkerBounded(worker, logger);
    await app.close();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void bootstrap().catch(() => {
  process.stderr.write("email_worker_startup_failed\n");
  process.exitCode = 1;
});
