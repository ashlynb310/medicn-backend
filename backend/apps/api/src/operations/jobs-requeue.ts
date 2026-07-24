import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { OperationalCommandsService } from "./operational-commands.service";
import { requestedHelp, requiredFlag } from "./operational-cli";

const HELP = `Usage: npm run jobs:requeue -- <job-execution-id> --idempotency-key <key> --reason <audited reason>

Queues a durable, audited retry only for an eligible retryable failed JobExecution.
Queue names and payloads are always recovered from the durable record; they cannot be supplied here.
`;

async function main() {
  const executionId = process.argv[2];
  if (requestedHelp()) {
    process.stdout.write(HELP);
    return;
  }
  if (!executionId || executionId.startsWith("--")) {
    throw new Error("A JobExecution ID is required. Use --help for usage.");
  }
  const idempotencyKey = requiredFlag("--idempotency-key");
  const reason = requiredFlag("--reason");
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(OperationalCommandsService).queueCliRequeue(
      executionId,
      { idempotencyKey, reason }
    );
    process.stdout.write(`Operational command ${result.id} accepted with status ${result.status}.\n`);
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write("job_requeue_command_failed; use --help for usage\n");
  process.exitCode = 1;
});
