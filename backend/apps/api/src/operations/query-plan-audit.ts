import { Prisma } from "@prisma/client";
import { config as loadEnvironment } from "dotenv";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaService } from "../prisma/prisma.service";

loadEnvironment({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const HOST_ID = "50000000-0000-4000-8000-000000000001";
const RENTER_ID = "50000000-0000-4000-8000-000000000002";
const LISTING_ID = "51000000-0000-4000-8000-000000000001";
const BOOKING_ID = "53000000-0000-4000-8000-000000000001";
const INQUIRY_ID = "54000000-0000-4000-8000-000000000001";

const SEED_SQL = `
INSERT INTO "User" ("id", "supabaseUserId", "email", "emailVerifiedAt", "roles", "createdAt", "updatedAt")
VALUES
  ('${HOST_ID}'::uuid, 'phase59b-host', 'phase59b-host@example.invalid', now(), ARRAY['host']::"UserRole"[], now(), now()),
  ('${RENTER_ID}'::uuid, 'phase59b-renter', 'phase59b-renter@example.invalid', now(), ARRAY['renter']::"UserRole"[], now(), now());

INSERT INTO "User" ("id", "supabaseUserId", "email", "emailVerifiedAt", "roles", "createdAt", "updatedAt")
SELECT
  ('50000000-0000-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid,
  'phase59b-renter-' || i, 'phase59b-renter-' || i || '@example.invalid', now(),
  ARRAY['renter']::"UserRole"[], now(), now()
FROM generate_series(1, 99) AS i;

INSERT INTO "Listing" (
  "id", "hostId", "title", "description", "city", "timeZone", "checkoutTime",
  "priceCents", "currency", "priceUnit", "listingType", "status", "createdAt", "updatedAt"
)
SELECT
  ('51000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '${HOST_ID}'::uuid, 'Plan listing ' || i, 'Seeded non-production query plan row',
  CASE WHEN i % 2 = 0 THEN 'Houston' ELSE 'Chicago' END, 'America/Chicago', '11:00',
  10000 + i, 'USD', 'night'::"PriceUnit", 'private_room'::"ListingType",
  'approved'::"ListingStatus", now() - (i || ' minutes')::interval, now()
FROM generate_series(1, 2000) AS i;

INSERT INTO "ListingAvailability" ("id", "listingId", "startDate", "endDate", "status", "createdAt", "updatedAt")
SELECT
  ('52000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('51000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  DATE '2026-01-01', DATE '2028-01-01', 'available'::"AvailabilityStatus", now(), now()
FROM generate_series(1, 2000) AS i;

INSERT INTO "Booking" (
  "id", "listingId", "renterId", "hostId", "startDate", "endDate", "timeZone",
  "checkoutTime", "selectedOption", "status", "totalAmountCents", "currency",
  "createdAt", "updatedAt", "requestExpiresAt"
)
SELECT
  ('53000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('51000000-0000-4000-8000-' || lpad((((i - 1) % 2000) + 1)::text, 12, '0'))::uuid,
  '${RENTER_ID}'::uuid, '${HOST_ID}'::uuid,
  DATE '2026-08-01' + ((i % 180) * interval '1 day'),
  DATE '2026-08-02' + ((i % 180) * interval '1 day'),
  'America/Chicago', '11:00', 'seed',
  CASE WHEN i % 4 = 0 THEN 'paid' ELSE 'requested' END::"BookingStatus",
  10000, 'USD', now() - (i || ' seconds')::interval, now(), now() + interval '24 hours'
FROM generate_series(1, 4000) AS i;

INSERT INTO "Inquiry" (
  "id", "listingId", "renterId", "hostId", "status", "lastSequence", "lastMessageAt", "createdAt", "updatedAt"
)
SELECT
  ('54000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('51000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  CASE WHEN i % 100 = 0 THEN '${RENTER_ID}'::uuid
    ELSE ('50000000-0000-4000-8000-' || lpad((100 + (i % 100))::text, 12, '0'))::uuid END,
  '${HOST_ID}'::uuid, 'open'::"InquiryStatus", 10,
  now() - (i || ' seconds')::interval, now(), now()
FROM generate_series(1, 1000) AS i;

INSERT INTO "Message" ("id", "inquiryId", "sequence", "senderId", "senderRole", "body", "createdAt")
SELECT
  ('55000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('54000000-0000-4000-8000-' || lpad((((i - 1) / 10) + 1)::text, 12, '0'))::uuid,
  ((i - 1) % 10) + 1, '${RENTER_ID}'::uuid, 'renter'::"UserRole", 'seed',
  now() - (i || ' milliseconds')::interval
FROM generate_series(1, 10000) AS i;

INSERT INTO "OutboxEvent" (
  "id", "eventType", "aggregateType", "aggregateId", "payload", "idempotencyKey",
  "status", "availableAt", "createdAt", "updatedAt"
)
SELECT
  ('57000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'seed', 'seed', i::text, '{}'::jsonb, 'phase59b-outbox-' || i,
  'pending'::"OutboxEventStatus", now() - (i || ' seconds')::interval, now(), now()
FROM generate_series(1, 5000) AS i;

INSERT INTO "JobExecution" (
  "id", "queueName", "jobType", "jobId", "attemptNumber", "state", "workerIdentity",
  "startedAt", "retryable", "createdAt", "updatedAt"
)
SELECT
  ('56000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  CASE WHEN i % 2 = 0 THEN 'operations' ELSE 'email' END, 'seed', 'phase59b-job-' || i,
  1, CASE WHEN i % 3 = 0 THEN 'failed' ELSE 'succeeded' END::"JobExecutionState",
  'redacted-seed', now() - (i || ' seconds')::interval, true, now(), now()
FROM generate_series(1, 5000) AS i;

INSERT INTO "Payment" (
  "id", "bookingId", "attemptNumber", "amountCents", "currency", "status",
  "active", "createdAt", "updatedAt"
)
SELECT
  ('58000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('53000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  1, 10000, 'USD', CASE WHEN i % 3 = 0 THEN 'failed' ELSE 'paid' END::"PaymentStatus",
  false, now() - (i || ' seconds')::interval, now() - (i || ' seconds')::interval
FROM generate_series(1, 4000) AS i;

INSERT INTO "ConnectedAccount" (
  "id", "userId", "providerAccountId", "lastSynchronizedAt", "createdAt", "updatedAt"
) VALUES (
  '59000000-0000-4000-8000-000000000001'::uuid, '${HOST_ID}'::uuid,
  'acct_phase59b', now(), now(), now()
);

INSERT INTO "HostTransfer" (
  "id", "bookingId", "paymentId", "hostId", "connectedAccountId",
  "providerConnectedAccountId", "grossAmountCents", "platformFeeCents", "hostNetAmountCents",
  "currency", "transferGroup", "status", "idempotencyKey", "eligibleAt", "createdAt", "updatedAt"
)
SELECT
  ('5a000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('53000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('58000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '${HOST_ID}'::uuid, '59000000-0000-4000-8000-000000000001'::uuid,
  'acct_phase59b', 10000, 1000, 9000, 'USD', 'phase59b-group-' || i,
  CASE WHEN i % 2 = 0 THEN 'pending' ELSE 'failed' END::"HostTransferStatus",
  'phase59b-transfer-' || i, now(), now() - (i || ' seconds')::interval,
  now() - (i || ' seconds')::interval
FROM generate_series(1, 1000) AS i;

INSERT INTO "OperationalCommand" (
  "id", "commandType", "source", "idempotencyKey", "requestedById", "reason", "status",
  "createdAt", "updatedAt"
)
SELECT
  ('5b000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'payment_reconciliation'::"OperationalCommandType", 'admin_api'::"OperationalCommandSource",
  'phase59b-command-' || i, '${HOST_ID}'::uuid, 'Seeded query plan evidence only',
  CASE WHEN i % 2 = 0 THEN 'queued' ELSE 'succeeded' END::"OperationalCommandStatus",
  now() - (i || ' seconds')::interval, now()
FROM generate_series(1, 2000) AS i;

ANALYZE "Listing", "ListingAvailability", "Booking", "Inquiry", "Message",
  "OutboxEvent", "JobExecution", "Payment", "HostTransfer", "OperationalCommand";
`;

const QUERIES = [
  {
    name: "listing_search_city_newest",
    sql: `SELECT "id" FROM "Listing" WHERE "status" = 'approved'::"ListingStatus" AND "deletedAt" IS NULL AND "city" = 'Houston' ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "listing_date_availability",
    sql: `SELECT "id" FROM "ListingAvailability" WHERE "listingId" = '${LISTING_ID}' AND "status" = 'available'::"AvailabilityStatus" AND "startDate" < DATE '2026-09-01' AND "endDate" > DATE '2026-08-01'`
  },
  {
    name: "listing_search_city_price",
    sql: `SELECT "id" FROM "Listing" WHERE "status" = 'approved'::"ListingStatus" AND "deletedAt" IS NULL AND "city" = 'Houston' ORDER BY "priceCents" ASC, "id" ASC LIMIT 20`
  },
  {
    name: "booking_renter_list",
    sql: `SELECT "id" FROM "Booking" WHERE "renterId" = '${RENTER_ID}' ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "booking_host_list",
    sql: `SELECT "id" FROM "Booking" WHERE "hostId" = '${HOST_ID}' ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "booking_detail",
    sql: `SELECT "id", "status" FROM "Booking" WHERE "id" = '${BOOKING_ID}'`
  },
  {
    name: "inquiry_participant_list",
    sql: `SELECT "id" FROM "Inquiry" WHERE "renterId" = '${RENTER_ID}' AND "closedAt" IS NULL ORDER BY "lastMessageAt" DESC NULLS LAST, "id" DESC LIMIT 20`
  },
  {
    name: "message_sequence_catchup",
    sql: `SELECT "id", "sequence" FROM "Message" WHERE "inquiryId" = '${INQUIRY_ID}' AND "sequence" > 4 ORDER BY "sequence" ASC LIMIT 100`
  },
  {
    name: "host_calendar_projection",
    sql: `SELECT "id", "startDate", "endDate" FROM "ListingAvailability" WHERE "listingId" = '${LISTING_ID}' AND "startDate" < DATE '2026-09-01' AND "endDate" > DATE '2026-08-01' ORDER BY "startDate" ASC`
  },
  {
    name: "admin_payment_list",
    sql: `SELECT "id" FROM "Payment" WHERE "status" = 'failed'::"PaymentStatus" ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "admin_transfer_list",
    sql: `SELECT "id" FROM "HostTransfer" WHERE "status" = 'failed'::"HostTransferStatus" ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "admin_job_list",
    sql: `SELECT "id" FROM "JobExecution" WHERE "queueName" = 'operations' AND "state" = 'failed'::"JobExecutionState" ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "admin_command_list",
    sql: `SELECT "id" FROM "OperationalCommand" WHERE "commandType" = 'payment_reconciliation'::"OperationalCommandType" AND "status" = 'queued'::"OperationalCommandStatus" ORDER BY "createdAt" DESC, "id" DESC LIMIT 20`
  },
  {
    name: "outbox_worker_scan",
    sql: `SELECT "id" FROM "OutboxEvent" WHERE "status" = 'pending'::"OutboxEventStatus" AND "availableAt" <= now() ORDER BY "availableAt" ASC, "id" ASC LIMIT 25`
  },
  {
    name: "booking_expiry_scan",
    sql: `SELECT "id" FROM "Booking" WHERE "status" = 'requested'::"BookingStatus" AND "requestExpiresAt" <= now() ORDER BY "requestExpiresAt" ASC, "id" ASC LIMIT 25`
  }
] as const;

class RollbackPlans extends Error {}

interface PlanNode {
  "Node Type"?: string;
  "Index Name"?: string;
  "Relation Name"?: string;
  Plans?: PlanNode[];
}

export interface QueryPlanEvidence {
  dataset: Record<string, number>;
  plans: Array<{
    name: string;
    planningTimeMs: number;
    executionTimeMs: number;
    nodes: Array<{
      nodeType: string;
      relation?: string;
      index?: string;
    }>;
  }>;
}

export async function collectQueryPlanEvidence(prisma: PrismaService) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Query-plan audit is forbidden in production.");
  }
  let evidence: QueryPlanEvidence | undefined;
  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(SEED_SQL);
        const plans: QueryPlanEvidence["plans"] = [];
        for (const query of QUERIES) {
          const rows = await transaction.$queryRawUnsafe<
            Array<{ "QUERY PLAN": Array<Record<string, unknown>> }>
          >(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`);
          const root = rows[0]?.["QUERY PLAN"]?.[0];
          if (!root) throw new Error(`Missing EXPLAIN result for ${query.name}.`);
          plans.push({
            name: query.name,
            planningTimeMs: Number(root["Planning Time"] ?? 0),
            executionTimeMs: Number(root["Execution Time"] ?? 0),
            nodes: flattenPlan(root.Plan as PlanNode)
          });
        }
        evidence = {
          dataset: {
            listings: 2000,
            availabilityWindows: 2000,
            bookings: 4000,
            inquiries: 1000,
            messages: 10000,
            payments: 4000,
            hostTransfers: 1000,
            jobExecutions: 5000,
            outboxEvents: 5000,
            operationalCommands: 2000
          },
          plans
        };
        throw new RollbackPlans();
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 }
    );
  } catch (error) {
    if (!(error instanceof RollbackPlans)) throw error;
  }
  if (!evidence) throw new Error("Query-plan evidence was not collected.");
  return evidence;
}

function flattenPlan(node: PlanNode): QueryPlanEvidence["plans"][number]["nodes"] {
  return [
    {
      nodeType: node["Node Type"] ?? "Unknown",
      ...(node["Relation Name"] ? { relation: node["Relation Name"] } : {}),
      ...(node["Index Name"] ? { index: node["Index Name"] } : {})
    },
    ...(node.Plans?.flatMap(flattenPlan) ?? [])
  ];
}

async function run() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Usage: query-plan-audit --write|--check");
  }
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const evidence = await collectQueryPlanEvidence(prisma);
    const target = resolve(__dirname, "../../../../docs/query-plan-evidence.json");
    const output = `${JSON.stringify(evidence, null, 2)}\n`;
    if (mode === "--write") await writeFile(target, output, "utf8");
    const sequential = evidence.plans.filter((plan) =>
      plan.nodes.some((node) => node.nodeType === "Seq Scan")
    );
    process.stdout.write(
      `query_plan_${mode === "--write" ? "written" : "checked"} plans=${evidence.plans.length} sequential=${sequential.map((plan) => plan.name).join(",") || "none"}\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Query-plan audit failed."}\n`
    );
    process.exitCode = 1;
  });
}
