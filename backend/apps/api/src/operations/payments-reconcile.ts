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

const HELP = `Usage: npm run payments:reconcile -- --idempotency-key <key> --reason <audited reason> [--payment-id <uuid>] [--limit <1-25>] [--stale-before <ISO-8601>]

Queues explicit PaymentIntent/payment/refund/dispute reconciliation. Without --payment-id,
only a bounded stale/non-terminal batch is selected. This command fails closed when Stripe is unavailable.
`;

async function main() {
  if (requestedHelp()) {
    process.stdout.write(HELP);
    return;
  }
  const input = {
    idempotencyKey: requiredFlag("--idempotency-key"),
    reason: requiredFlag("--reason"),
    targetId: flagValue("--payment-id"),
    limit: boundedLimit(),
    staleBefore: flagValue("--stale-before")
  };
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(OperationalCommandsService).queueCliReconciliation(
      OperationalCommandType.payment_reconciliation,
      input
    );
    process.stdout.write(`Operational command ${result.id} accepted with status ${result.status}.\n`);
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write("payment_reconciliation_command_failed; use --help for usage\n");
  process.exitCode = 1;
});
