import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  ConnectCapabilityStatus,
  StripeAccountApiModel,
  UserRole
} from "@prisma/client";
import type Stripe from "stripe";
import type { AuthService } from "../src/auth/auth.service";
import { ConnectService } from "../src/payments/connect.service";
import type { StripeService } from "../src/payments/stripe.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T00:00:00.000Z");

const host = {
  id: "b6027d69-b86a-4e71-8d1c-c47ae6c2db1a",
  supabaseUserId: "supabase-host",
  email: "host@example.com",
  emailVerifiedAt: now,
  firstName: "Taylor",
  lastName: "Host",
  displayName: "Taylor Host",
  healthcareRole: null,
  roles: [UserRole.host] as UserRole[],
  healthcareAffiliation: null,
  phoneNumber: null,
  bio: null,
  profilePhotoUrl: null,
  profileComplete: true,
  currentVerificationStatus: "not_started",
  disabledAt: null,
  createdAt: now,
  updatedAt: now
};

function providerAccount(status: "active" | "pending" = "pending") {
  return {
    id: "acct_v2_host",
    object: "v2.core.account",
    applied_configurations: ["recipient"],
    contact_email: host.email,
    created: now.toISOString(),
    dashboard: "express",
    livemode: false,
    defaults: {
      currency: "usd",
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
        requirements_collector: "stripe"
      }
    },
    identity: { country: "US" },
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status, status_details: [] },
            payouts: { status, status_details: [] }
          }
        }
      }
    },
    requirements:
      status === "active"
        ? { entries: [] }
        : {
            entries: [
              {
                awaiting_action_from: "user",
                description: "sensitive provider description not persisted",
                errors: [],
                impact: {
                  restricts_capabilities: [
                    {
                      capability: "stripe_balance.stripe_transfers",
                      configuration: "recipient",
                      deadline: { status: "currently_due" }
                    }
                  ]
                },
                minimum_deadline: { status: "currently_due" },
                requested_reasons: [{ code: "routine_onboarding" }]
              }
            ]
          }
  } as unknown as Stripe.V2.Core.Account;
}

function storedAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "connected_1",
    userId: host.id,
    providerAccountId: "acct_v2_host",
    apiModel: StripeAccountApiModel.accounts_v2_recipient,
    country: "US",
    currency: "USD",
    detailsSubmitted: false,
    transfersCapability: ConnectCapabilityStatus.pending,
    transfersReady: false,
    payoutsEnabled: false,
    requirementsCurrentlyDue: [],
    requirementsPastDue: [],
    lastSynchronizedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createService(currentUser = host) {
  const prisma = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    booking: { findUnique: jest.fn() },
    connectedAccount: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    }
  };
  const prismaWithTransaction = {
    ...prisma,
    $transaction: jest.fn(async (callback) => callback(prisma))
  };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(currentUser) };
  const stripe = {
    createRecipientAccount: jest.fn(),
    retrieveRecipientAccount: jest.fn(),
    createRecipientAccountLink: jest.fn()
  };
  const config = {
    get: jest.fn((key: string) =>
      ({
        STRIPE_CONNECT_ENABLED: true,
        PLATFORM_FEE_BPS: 1250,
        HOST_TRANSFER_DELAY_HOURS: 24,
        STRIPE_SECRET_KEY: "sk_test_configured",
        NEXT_PUBLIC_APP_URL: "https://medicn.example.com"
      })[key]
    )
  };
  const service = new ConnectService(
    prismaWithTransaction as unknown as PrismaService,
    auth as unknown as AuthService,
    stripe as unknown as StripeService,
    config as unknown as ConfigService
  );
  return { service, prisma, auth, stripe };
}

describe("ConnectService", () => {
  it("forbids renter-only connected-account access", async () => {
    const context = createService({ ...host, roles: [UserRole.renter] });
    await expect(
      context.service.createOrReuseAccount("token", { country: "US" })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows an Admin to create a Host account with stable idempotency", async () => {
    const context = createService({ ...host, id: "admin_1", roles: [UserRole.admin] });
    context.prisma.user.findUnique.mockResolvedValue(host);
    context.prisma.connectedAccount.findUnique.mockResolvedValue(null);
    context.stripe.createRecipientAccount.mockResolvedValue(providerAccount());
    context.prisma.connectedAccount.create.mockResolvedValue(storedAccount());

    await context.service.createOrReuseAccount("token", {
      country: "US",
      hostUserId: host.id
    });

    expect(context.stripe.createRecipientAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: host.id,
        idempotencyKey: `connect-account:${host.id}`
      })
    );
  });

  it("reuses the persisted provider account without another Stripe create", async () => {
    const context = createService();
    context.prisma.connectedAccount.findUnique.mockResolvedValue(storedAccount());
    await expect(
      context.service.createOrReuseAccount("token", { country: "CA" })
    ).resolves.toMatchObject({ providerAccountId: "acct_v2_host" });
    expect(context.stripe.createRecipientAccount).not.toHaveBeenCalled();
  });

  it("does not treat an incomplete hosted onboarding return as ready", async () => {
    const context = createService();
    context.prisma.connectedAccount.findUnique.mockResolvedValue(storedAccount());
    context.stripe.retrieveRecipientAccount.mockResolvedValue(providerAccount());
    context.prisma.connectedAccount.update.mockImplementation(({ data }) =>
      Promise.resolve(storedAccount(data))
    );

    const response = await context.service.synchronizeAccount("token", {});
    expect(response).toMatchObject({
      transfersCapability: ConnectCapabilityStatus.pending,
      transfersReady: false,
      detailsSubmitted: false
    });
  });

  it("synchronizes active transfer and payout readiness from Stripe", async () => {
    const context = createService();
    context.prisma.connectedAccount.findUnique.mockResolvedValue(storedAccount());
    context.stripe.retrieveRecipientAccount.mockResolvedValue(
      providerAccount("active")
    );
    context.prisma.connectedAccount.update.mockImplementation(({ data }) =>
      Promise.resolve(storedAccount(data))
    );

    await expect(
      context.service.synchronizeAccount("token", {})
    ).resolves.toMatchObject({
      transfersCapability: ConnectCapabilityStatus.active,
      transfersReady: true,
      payoutsEnabled: true,
      detailsSubmitted: true
    });
  });

  it("returns only allowlisted non-sensitive account fields", async () => {
    const context = createService();
    context.prisma.connectedAccount.findUnique.mockResolvedValue(storedAccount());
    context.stripe.retrieveRecipientAccount.mockResolvedValue(providerAccount());
    context.prisma.connectedAccount.update.mockImplementation(({ data }) =>
      Promise.resolve(storedAccount(data))
    );
    const response = await context.service.synchronizeAccount("token", {});
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("contact_email");
    expect(serialized).not.toContain("identity");
    expect(serialized).not.toContain("sensitive provider description");
    expect(serialized).not.toContain("bank");
    expect(serialized).not.toContain("tax");
  });
});
