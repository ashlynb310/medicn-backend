import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { MediaProcessingService } from "./media-processing.service";
import { HealthcareEvidenceDeletionService } from "../healthcare/healthcare-evidence-deletion.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const limit = Math.max(1, Math.min(1000, Number(process.argv[2]) || 25));
    const count = await app.get(MediaProcessingService).recover(limit);
    const healthcare = await app.get(HealthcareEvidenceDeletionService).recover(limit);
    process.stdout.write(
      `Recovered ${count} media asset(s) and ${healthcare} healthcare deletion(s).\n`
    );
  } finally { await app.close(); }
}
void run();
