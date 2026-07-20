import { OutboxEventStatus } from "@prisma/client";
import { JobsService } from "../src/jobs/jobs.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("Outbox PostgreSQL claim concurrency", () => {
  let prisma: PrismaService;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { startsWith: suffix } } });
      await prisma.$disconnect();
    }
  });

  it("allows concurrent publishers to claim each row once", async () => {
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        eventType: "send_transactional_email",
        aggregateType: "integration",
        aggregateId: `${suffix}-concurrent-${index}`,
        payload: {},
        idempotencyKey: `${suffix}:concurrent:${index}`
      }))
    });
    const first = new JobsService(prisma);
    const second = new JobsService(prisma);
    const [firstClaims, secondClaims] = await Promise.all([
      first.claimPublishableJobs(10, "publisher-one", 30_000),
      second.claimPublishableJobs(10, "publisher-two", 30_000)
    ]);
    const ids = [...firstClaims, ...secondClaims].map((row) => row.id);

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("recovers an expired claim but not a live claim", async () => {
    const [expired, live] = await Promise.all([
      prisma.outboxEvent.create({
        data: {
          eventType: "send_transactional_email",
          aggregateType: "integration",
          aggregateId: `${suffix}-expired`,
          payload: {},
          idempotencyKey: `${suffix}:expired`,
          status: OutboxEventStatus.publishing,
          claimedBy: "dead-publisher",
          claimedAt: new Date(Date.now() - 60_000),
          claimExpiresAt: new Date(Date.now() - 1_000)
        }
      }),
      prisma.outboxEvent.create({
        data: {
          eventType: "send_transactional_email",
          aggregateType: "integration",
          aggregateId: `${suffix}-live`,
          payload: {},
          idempotencyKey: `${suffix}:live`,
          status: OutboxEventStatus.publishing,
          claimedBy: "live-publisher",
          claimedAt: new Date(),
          claimExpiresAt: new Date(Date.now() + 60_000)
        }
      })
    ]);

    const claimed = await new JobsService(prisma).claimPublishableJobs(
      10,
      "recovery-publisher",
      30_000,
      ["send_transactional_email"]
    );

    expect(claimed.map((row) => row.id)).toContain(expired.id);
    expect(claimed.map((row) => row.id)).not.toContain(live.id);
  });
});
