import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { InquiriesController } from "./inquiries.controller";
import { InquiryCreationController } from "./inquiry-creation.controller";
import { MessagingGateway } from "./messaging.gateway";
import { MessagingRealtimeService } from "./messaging-realtime.service";
import { MessagingService } from "./messaging.service";

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [InquiryCreationController, InquiriesController],
  providers: [MessagingService, MessagingRealtimeService, MessagingGateway],
  exports: [MessagingService]
})
export class MessagingModule {}
