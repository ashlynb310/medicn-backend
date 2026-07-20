import { NestFactory } from "@nestjs/core";
import { OperationalCommandType } from "@prisma/client";
import { AppModule } from "../app.module";
import { OperationalCommandsService } from "./operational-commands.service";
import {
  boundedLimit,
  flagValue,
  requestedHelp,
  requiredFlag
} from "./operational-cli";

const HELP = `Usage: npm run host-transfers:reconcile -- --idempotency-key <key> --reason <audited reason> [--host-transfer-id <uuid>] [--limit <1-25>] [--stale-before <ISO-8601>]

Queues explicit Stripe Transfer/reversal reconciliation. A Stripe Transfer represents movement
to a connected Stripe balance, not confirmation of a bank payout. Batches are stale and bounded.
`;

async function main() {
  if (requestedHelp()) {
    process.stdout.write(HELP);
    return;
  }
  const input = {
    idempotencyKey: requiredFlag("--idempotency-key"),
    reason: requiredFlag("--reason"),
    targetId: flagValue("--host-transfer-id"),
    limit: boundedLimit(),
    staleBefore: flagValue("--stale-before")
  };
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(OperationalCommandsService).queueCliReconciliation(
      OperationalCommandType.host_transfer_reconciliation,
      input
    );
    process.stdout.write(`Operational command ${result.id} accepted with status ${result.status}.\n`);
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write("host_transfer_reconciliation_command_failed; use --help for usage\n");
  process.exitCode = 1;
});
