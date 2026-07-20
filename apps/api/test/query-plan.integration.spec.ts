import { collectQueryPlanEvidence } from "../src/operations/query-plan-audit";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("seeded PostgreSQL high-traffic query plans", () => {
  jest.setTimeout(150_000);
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("uses bounded index-backed plans and rolls the non-production seed back", async () => {
    const evidence = await collectQueryPlanEvidence(prisma);
    expect(evidence.plans).toHaveLength(15);
    const sequential = evidence.plans.filter((plan) =>
      plan.nodes.some((node) => node.nodeType === "Seq Scan")
    );
    expect(sequential).toEqual([]);
    expect(
      evidence.plans.flatMap((plan) => plan.nodes.map((node) => node.index))
    ).toEqual(
      expect.arrayContaining([
        "Listing_status_city_createdAt_id_idx",
        "Listing_status_city_priceCents_id_idx",
        "Booking_renterId_createdAt_id_idx",
        "Booking_hostId_createdAt_id_idx",
        "Message_inquiryId_sequence_key",
        "Payment_status_createdAt_id_idx",
        "HostTransfer_status_createdAt_id_idx",
        "JobExecution_queueName_state_createdAt_id_idx",
        "OutboxEvent_status_availableAt_idx"
      ])
    );
    await expect(
      prisma.user.count({ where: { supabaseUserId: { startsWith: "phase59b-" } } })
    ).resolves.toBe(0);
  });
});
