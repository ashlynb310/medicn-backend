import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import {
  STRIPE_API_VERSION,
  StripeService
} from "../src/payments/stripe.service";

describe("StripeService", () => {
  function createService() {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          STRIPE_SECRET_KEY: "sk_test_configured",
          STRIPE_WEBHOOK_SECRET: "whsec_configured",
          NEXT_PUBLIC_APP_URL: "https://medicn.example.com"
        };
        return values[key];
      })
    };
    const stripe = {
      checkout: {
        sessions: {
          create: jest.fn(),
          retrieve: jest.fn(),
          expire: jest.fn()
        }
      },
      refunds: { create: jest.fn() },
      paymentIntents: { retrieve: jest.fn() },
      charges: { retrieve: jest.fn() },
      disputes: { list: jest.fn() },
      accounts: { create: jest.fn() },
      v2: {
        core: {
          accounts: { create: jest.fn(), retrieve: jest.fn() },
          accountLinks: { create: jest.fn() }
        }
      },
      transfers: {
        create: jest.fn(),
        createReversal: jest.fn(),
        retrieve: jest.fn(),
        list: jest.fn()
      },
      webhooks: { constructEvent: jest.fn() }
    };
    const service = new StripeService(config as unknown as ConfigService);
    (service as unknown as { stripe: typeof stripe }).stripe = stripe;
    return { service, stripe };
  }

  it("pins the supported Stripe API version", () => {
    expect(STRIPE_API_VERSION).toBe("2026-06-24.dahlia");
  });

  it("creates Checkout through the SDK with stable idempotency and fulfillment metadata", async () => {
    const { service, stripe } = createService();
    const bookingId = "123e4567-e89b-12d3-a456-426614174000";
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/c/pay/cs_123",
      payment_intent: null,
      expires_at: Math.floor(expiresAt.getTime() / 1000)
    } as Stripe.Checkout.Session);

    await service.createCheckoutSession({
      bookingId,
      paymentId: "payment_1",
      amountCents: 16_000,
      currency: "USD",
      listingTitle: "Private room",
      idempotencyKey: "checkout:booking_1:1:stable",
      expiresAt
    });

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        success_url:
          `https://medicn.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}&bookingId=${encodeURIComponent(
            bookingId
          )}`,
        cancel_url:
          `https://medicn.example.com/checkout/cancel?bookingId=${encodeURIComponent(
            bookingId
          )}`,
        client_reference_id: bookingId,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        metadata: {
          bookingId,
          paymentId: "payment_1"
        },
        payment_intent_data: {
          metadata: {
            bookingId,
            paymentId: "payment_1"
          }
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: 16_000,
              product_data: { name: "Private room" }
            }
          }
        ]
      }),
      { idempotencyKey: "checkout:booking_1:1:stable" }
    );
    const request = stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(request.success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(request.success_url).toContain(
      `bookingId=${encodeURIComponent(bookingId)}`
    );
    expect(request.cancel_url).toContain(
      `bookingId=${encodeURIComponent(bookingId)}`
    );
    expect(`${request.success_url} ${request.cancel_url}`).not.toMatch(
      /sk_test_configured|whsec_configured/
    );
  });

  it("uses SDK constructEvent against the untouched bytes", () => {
    const { service, stripe } = createService();
    const rawBody = Buffer.from('{"id":"evt_1"}');
    stripe.webhooks.constructEvent.mockReturnValue({ id: "evt_1" });

    service.constructWebhookEvent(rawBody, "valid-signature");

    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      rawBody,
      "valid-signature",
      "whsec_configured"
    );
  });

  it("expires Checkout with a stable provider idempotency key", async () => {
    const { service, stripe } = createService();
    stripe.checkout.sessions.expire.mockResolvedValue({
      id: "cs_123",
      status: "expired"
    });

    await expect(
      service.expireCheckoutSession({
        checkoutSessionId: "cs_123",
        idempotencyKey: "cancel-checkout:operation_1"
      })
    ).resolves.toMatchObject({ id: "cs_123", status: "expired" });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_123",
      {},
      { idempotencyKey: "cancel-checkout:operation_1" }
    );
  });

  it("creates only the stored remaining full refund with stable metadata and idempotency", async () => {
    const { service, stripe } = createService();
    stripe.refunds.create.mockResolvedValue({ id: "re_1", status: "pending" });

    await expect(
      service.createFullRefund({
        paymentIntentId: "pi_1",
        amountCents: 12_000,
        bookingId: "booking_1",
        paymentId: "payment_1",
        cancellationOperationId: "operation_1",
        idempotencyKey: "cancel-refund:operation_1:12000"
      })
    ).resolves.toMatchObject({ id: "re_1", status: "pending" });
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: "pi_1",
        amount: 12_000,
        metadata: {
          bookingId: "booking_1",
          paymentId: "payment_1",
          cancellationOperationId: "operation_1"
        }
      },
      { idempotencyKey: "cancel-refund:operation_1:12000" }
    );
  });

  it("associates Checkout with a transfer group without a destination transfer", async () => {
    const { service, stripe } = createService();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/c/pay/cs_123",
      payment_intent: null,
      expires_at: Math.floor(expiresAt.getTime() / 1000)
    } as Stripe.Checkout.Session);

    await service.createCheckoutSession({
      bookingId: "booking_1",
      paymentId: "payment_1",
      amountCents: 16_000,
      currency: "USD",
      listingTitle: "Private room",
      idempotencyKey: "checkout:booking_1:1:stable",
      expiresAt,
      transferGroup: "booking_booking_1"
    });

    const request = stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(request.payment_intent_data).toEqual({
      metadata: { bookingId: "booking_1", paymentId: "payment_1" },
      transfer_group: "booking_booking_1"
    });
    expect(request.payment_intent_data).not.toHaveProperty("transfer_data");
  });

  it("creates only an Accounts v2 recipient with stable idempotency", async () => {
    const { service, stripe } = createService();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_v2" });
    await service.createRecipientAccount({
      userId: "host_1",
      email: "host@example.com",
      displayName: "Host",
      country: "US",
      idempotencyKey: "connect-account:host_1"
    });
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboard: "express",
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } }
            }
          }
        }
      }),
      { idempotencyKey: "connect-account:host_1" }
    );
    expect(stripe.accounts.create).not.toHaveBeenCalled();
  });

  it("creates hosted v2 account-update links for management", async () => {
    const { service, stripe } = createService();
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://connect.stripe.com/setup",
      expires_at: "2026-07-19T00:10:00.000Z"
    });
    await service.createRecipientAccountLink("acct_v2", "account_update");
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_v2",
      use_case: expect.objectContaining({
        type: "account_update",
        account_update: expect.objectContaining({
          configurations: ["recipient"]
        })
      })
    });
  });

  it("creates delayed transfers with source_transaction and stable idempotency", async () => {
    const { service, stripe } = createService();
    stripe.transfers.create.mockResolvedValue({ id: "tr_1" });
    await service.createHostTransfer({
      amountCents: 14_000,
      currency: "USD",
      destination: "acct_v2",
      sourceChargeId: "ch_1",
      transferGroup: "booking_1",
      bookingId: "booking_1",
      hostTransferId: "host_transfer_1",
      idempotencyKey: "host-transfer:booking_1:payment_1"
    });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 14_000,
        destination: "acct_v2",
        source_transaction: "ch_1",
        transfer_group: "booking_1"
      }),
      { idempotencyKey: "host-transfer:booking_1:payment_1" }
    );
  });

  it("never acknowledges an invalid SDK signature", () => {
    const { service, stripe } = createService();
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    expect(() =>
      service.constructWebhookEvent(Buffer.from("{}"), "bad-signature")
    ).toThrow(UnauthorizedException);
  });

  it("retrieves bounded reconciliation snapshots with required expansions", async () => {
    const { service, stripe } = createService();
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1" });
    stripe.transfers.retrieve.mockResolvedValue({ id: "tr_1" });
    stripe.transfers.list.mockResolvedValue({ data: [{ id: "tr_1" }] });
    stripe.disputes.list.mockResolvedValue({ data: [{ id: "dp_1" }] });

    await service.retrievePaymentIntentForReconciliation("pi_1");
    await service.retrieveHostTransferForReconciliation("tr_1");
    await service.findHostTransfersForReconciliation("booking_1");
    await service.findDisputesForReconciliation("pi_1");

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", {
      expand: ["latest_charge"]
    });
    expect(stripe.transfers.retrieve).toHaveBeenCalledWith("tr_1", {
      expand: ["reversals"]
    });
    expect(stripe.transfers.list).toHaveBeenCalledWith({
      transfer_group: "booking_1",
      limit: 2
    });
    expect(stripe.disputes.list).toHaveBeenCalledWith({
      payment_intent: "pi_1",
      limit: 2
    });
  });

  it.each([
    ["StripeRateLimitError", "stripe_rate_limited", true],
    ["StripeConnectionError", "stripe_provider_unavailable", true],
    ["StripeInvalidRequestError", "stripe_resource_missing", false]
  ])(
    "classifies %s reconciliation failures without raw provider data",
    async (type, category, retryable) => {
      const { service, stripe } = createService();
      stripe.paymentIntents.retrieve.mockRejectedValue({
        type,
        code: type === "StripeInvalidRequestError" ? "resource_missing" : "secret_code",
        raw: { message: "sensitive provider response" }
      });
      await expect(service.retrievePaymentIntentForReconciliation("pi_1"))
        .rejects.toMatchObject({ category, retryable });
      await expect(service.retrievePaymentIntentForReconciliation("pi_1"))
        .rejects.not.toThrow("sensitive provider response");
    }
  );
});
