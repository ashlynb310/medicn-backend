import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { EmailWebhookService } from "./email-webhook.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const limit = Math.min(Math.max(Number(process.argv[2] ?? 100), 1), 500);
    const result = await app.get(EmailWebhookService).retryFailed(limit);
    process.stdout.write(`Retried ${result.scanned} transactional email webhook event(s).\n`);
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write("email_webhook_retry_failed\n");
  process.exitCode = 1;
});
