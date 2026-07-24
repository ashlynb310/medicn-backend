import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { MapsModule } from "../maps/maps.module";
import { MediaModule } from "../media/media.module";
import { PaymentsModule } from "../payments/payments.module";
import { OperationsQueueService } from "./operations-queue.service";
import { OperationsService } from "./operations.service";
import { QueueObservabilityService } from "./queue-observability.service";
import { JobRecoveryService } from "./job-recovery.service";
import { OperationalCommandsService } from "./operational-commands.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule, PaymentsModule, IdentityModule, MediaModule, MapsModule, EmailModule, JobsModule],
  providers: [OperationsService, OperationsQueueService, QueueObservabilityService, JobRecoveryService, OperationalCommandsService],
  exports: [OperationsService, OperationsQueueService, QueueObservabilityService, JobRecoveryService, OperationalCommandsService]
})
export class OperationsModule {}
