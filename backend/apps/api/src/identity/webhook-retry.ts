import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { IdentityService } from "./identity.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"]
  });
  try {
    const limit = Number(process.argv[2] ?? 25);
    const result = await app.get(IdentityService).retryFailedWebhookEvents(limit);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

void main();
