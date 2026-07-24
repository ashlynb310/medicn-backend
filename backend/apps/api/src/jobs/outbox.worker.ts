import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { WorkerProcessType } from "@prisma/client";
import { AppModule } from "../app.module";
import { OutboxPublisherService } from "./outbox-publisher.service";
import { WorkerHeartbeatService } from "./worker-heartbeat.service";
import { createWorkerIdentity, startWorkerHeartbeat } from "./worker-runtime";

async function bootstrap() {
  const logger = new Logger("OutboxWorker");
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const publisher = app.get(OutboxPublisherService);
  const identity = createWorkerIdentity(WorkerProcessType.outbox);
  const stopHeartbeat = startWorkerHeartbeat(
    app.get(WorkerHeartbeatService), config, WorkerProcessType.outbox, identity, logger
  );
  const pollIntervalMs = config.get<number>("OUTBOX_POLL_INTERVAL_MS") ?? 5_000;
  let stopping = false;
  let running: Promise<void> | undefined;
  const publish = () => {
    if (running || stopping) return;
    running = publisher.publishPending(50)
      .then((result) => {
        if (result.total > 0) logger.log(`outbox_batch total=${result.total} published=${result.published} failed=${result.failed}`);
      })
      .catch(() => logger.error("outbox_batch_failed"))
      .finally(() => { running = undefined; });
  };
  publish();
  const interval = setInterval(publish, pollIntervalMs);
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    stopHeartbeat();
    await running;
    await app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  logger.log(`worker_started process=outbox poll_ms=${pollIntervalMs}`);
}

void bootstrap().catch(() => {
  process.stderr.write("outbox_worker_startup_failed\n");
  process.exitCode = 1;
});
