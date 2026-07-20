import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { OutboxPublisherService } from "../jobs/outbox-publisher.service";
import { EmailService } from "./email.service";

async function bootstrap() {
  const logger = new Logger("EmailSmoke");
  const app = await NestFactory.createApplicationContext(AppModule);
  const email = app.get(EmailService);
  const publisher = app.get(OutboxPublisherService);
  const smokeId = `email-smoke:${Date.now()}`;

  await email.queueTransactionalEmail(
    {
      to: "smoke@medicn.test",
      template: "booking_requested_host",
      subject: "MediCN email smoke test",
      text: "This smoke event verifies the outbox-to-BullMQ email path.",
      metadata: {
        smokeId
      }
    },
    {
      aggregateId: smokeId,
      aggregateType: "smoke",
      deduplicationKey: smokeId
    }
  );

  const result = await publisher.publishPending();
  logger.log(JSON.stringify({ smokeId, ...result }));
  await app.close();
}

void bootstrap();
