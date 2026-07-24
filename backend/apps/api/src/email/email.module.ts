import { Module } from "@nestjs/common";
import { JobsModule } from "../jobs/jobs.module";
import { EmailService } from "./email.service";
import { EmailWebhookController } from "./email-webhook.controller";
import { EmailWebhookService } from "./email-webhook.service";

@Module({
  imports: [JobsModule],
  controllers: [EmailWebhookController],
  providers: [EmailService, EmailWebhookService],
  exports: [EmailService, EmailWebhookService]
})
export class EmailModule {}
