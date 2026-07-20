import { Module } from "@nestjs/common";
import { BullMqEmailQueueService } from "./bullmq-email-queue.service";
import { BullMqMediaQueueService } from "./bullmq-media-queue.service";
import { BullMqMapsQueueService } from "./bullmq-maps-queue.service";
import { JobsService } from "./jobs.service";
import { OutboxPublisherService } from "./outbox-publisher.service";
import { JobExecutionService } from "./job-execution.service";
import { WorkerHeartbeatService } from "./worker-heartbeat.service";
import { BullMqOperationsQueueService } from "./bullmq-operations-queue.service";

@Module({
  providers: [BullMqEmailQueueService, BullMqMediaQueueService, BullMqMapsQueueService, BullMqOperationsQueueService, JobsService, OutboxPublisherService, JobExecutionService, WorkerHeartbeatService],
  exports: [JobsService, OutboxPublisherService, JobExecutionService, WorkerHeartbeatService, BullMqOperationsQueueService]
})
export class JobsModule {}
