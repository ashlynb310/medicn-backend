import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HealthcareSubmissionStatus,
  IdentityProvider,
  IdentityVerificationStatus,
  VerificationStatus
} from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

function migrationBlock(sql: string, name: string) {
  const start = `-- ${name}:start`;
  const end = `-- ${name}:end`;
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Migration block ${name} was not found.`);
  }
  return sql.slice(startIndex + start.length, endIndex).trim();
}

describeWithDatabase("identity/healthcare separation migration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userWithGenuineId = `migration-genuine-user-${suffix}`;
  const legacyOnlyUserId = `migration-legacy-user-${suffix}`;
  const legacyWithGenuineId = `migration-legacy-genuine-${suffix}`;
  const genuineHealthcareId = `migration-healthcare-genuine-${suffix}`;
  const legacyOnlyId = `migration-legacy-only-${suffix}`;
  let prisma: PrismaService;
  let provenanceDml: string;
  let statusDml: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
      throw new Error(
        "RUN_DATABASE_INTEGRATION_TESTS requires a PostgreSQL DATABASE_URL."
      );
    }
    const migration = readFileSync(
      resolve(
        __dirname,
        "../../../prisma/migrations/20260726000000_separate_identity_healthcare_status/migration.sql"
      ),
      "utf8"
    );
    provenanceDml = migrationBlock(migration, "provenance-backfill");
    statusDml = migrationBlock(migration, "healthcare-status-backfill");

    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: userWithGenuineId,
          supabaseUserId: `supabase-${userWithGenuineId}`,
          email: `${userWithGenuineId}@example.com`,
          currentVerificationStatus: VerificationStatus.approved
        },
        {
          id: legacyOnlyUserId,
          supabaseUserId: `supabase-${legacyOnlyUserId}`,
          email: `${legacyOnlyUserId}@example.com`,
          currentVerificationStatus: VerificationStatus.approved
        }
      ]
    });
    await prisma.healthcareVerification.createMany({
      data: [
        {
          id: legacyWithGenuineId,
          userId: userWithGenuineId,
          version: 1,
          status: VerificationStatus.approved,
          submissionStatus: HealthcareSubmissionStatus.evidence_deleted,
          legacyRecord: true,
          legacyIdentitySource: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z")
        },
        {
          id: genuineHealthcareId,
          userId: userWithGenuineId,
          version: 2,
          status: VerificationStatus.pending,
          submissionStatus: HealthcareSubmissionStatus.pending_review,
          legacyRecord: true,
          legacyIdentitySource: false,
          createdAt: new Date("2026-02-01T00:00:00.000Z")
        },
        {
          id: legacyOnlyId,
          userId: legacyOnlyUserId,
          version: 1,
          status: VerificationStatus.approved,
          submissionStatus: HealthcareSubmissionStatus.evidence_deleted,
          legacyRecord: true,
          legacyIdentitySource: false,
          createdAt: new Date("2026-03-01T00:00:00.000Z")
        }
      ]
    });
    await prisma.identityVerification.createMany({
      data: [
        {
          id: legacyWithGenuineId,
          userId: userWithGenuineId,
          provider: IdentityProvider.veriff,
          providerSessionId: `provider-${legacyWithGenuineId}`,
          vendorData: `vendor-${legacyWithGenuineId}`,
          status: IdentityVerificationStatus.approved
        },
        {
          id: legacyOnlyId,
          userId: legacyOnlyUserId,
          provider: IdentityProvider.veriff,
          providerSessionId: `provider-${legacyOnlyId}`,
          vendorData: `vendor-${legacyOnlyId}`,
          status: IdentityVerificationStatus.approved
        }
      ]
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.identityVerification.deleteMany({
        where: { userId: { in: [userWithGenuineId, legacyOnlyUserId] } }
      });
      await prisma.healthcareVerification.deleteMany({
        where: { userId: { in: [userWithGenuineId, legacyOnlyUserId] } }
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userWithGenuineId, legacyOnlyUserId] } }
      });
      await prisma.$disconnect();
    }
  });

  it("marks copied Veriff rows, preserves genuine healthcare and identity, and is idempotent", async () => {
    for (let pass = 0; pass < 2; pass += 1) {
      await prisma.$executeRawUnsafe(provenanceDml);
      await prisma.$executeRawUnsafe(statusDml);
    }

    await expect(
      prisma.healthcareVerification.findUniqueOrThrow({
        where: { id: legacyWithGenuineId },
        select: { legacyIdentitySource: true, status: true }
      })
    ).resolves.toEqual({
      legacyIdentitySource: true,
      status: VerificationStatus.approved
    });
    await expect(
      prisma.healthcareVerification.findUniqueOrThrow({
        where: { id: genuineHealthcareId },
        select: { legacyIdentitySource: true, status: true }
      })
    ).resolves.toEqual({
      legacyIdentitySource: false,
      status: VerificationStatus.pending
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userWithGenuineId },
        select: { currentVerificationStatus: true }
      })
    ).resolves.toEqual({ currentVerificationStatus: VerificationStatus.pending });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: legacyOnlyUserId },
        select: { currentVerificationStatus: true }
      })
    ).resolves.toEqual({ currentVerificationStatus: VerificationStatus.not_started });
    await expect(
      prisma.identityVerification.findMany({
        where: { userId: { in: [userWithGenuineId, legacyOnlyUserId] } },
        select: { status: true }
      })
    ).resolves.toEqual([
      { status: IdentityVerificationStatus.approved },
      { status: IdentityVerificationStatus.approved }
    ]);
  });
});
