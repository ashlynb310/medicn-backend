import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { OperationsService } from "./operations.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(OperationsService).recoverStale();
    process.stdout.write(`Recovered ${result.outbox} outbox claim(s) and ${result.executions} stale execution(s).\n`);
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write("job_recovery_failed\n");
  process.exitCode = 1;
});
