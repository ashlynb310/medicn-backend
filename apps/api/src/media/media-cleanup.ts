import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { MediaProcessingService } from "./media-processing.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const limit = Math.max(1, Math.min(1000, Number(process.argv[2]) || 100));
    const count = await app.get(MediaProcessingService).cleanupDue(limit);
    process.stdout.write(`Cleaned ${count} media asset(s).\n`);
  } finally { await app.close(); }
}
void run();
