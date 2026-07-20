import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { LocationService } from "./location.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const limit = Math.max(1, Math.min(1000, Number(process.argv[2]) || 25));
    const count = await app.get(LocationService).queueExpiredForRefresh(limit);
    process.stdout.write(`Refreshed ${count} listing enrichment record(s).\n`);
  } finally { await app.close(); }
}
void run();
