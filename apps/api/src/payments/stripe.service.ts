import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { OperationalError } from "../jobs/operational-error";

export const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

export interface StripeCheckoutSessionInput {
  bookingId: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  listingTitle: string;
  idempotencyKey: string;
  expiresAt: Date;
  transferGroup?: string;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  paymentIntentId: string | null;
  expiresAt: Date;
}

export interface StripeRecipientAccountInput {
  userId: string;
  email: string;
  displayName: string;
  country: string;
  idempotencyKey: string;
}

export interface StripeFullRefundInput {
  paymentIntentId: string;
  amountCents: number;
  bookingId: string;
  paymentId: string;
  cancellationOperationId: string;
  idempotencyKey: string;
}

@Injectable()
export class StripeService {
  private stripe?: Stripe;

  constructor(private readonly config: ConfigService) {}

  async createCheckoutSession(
    input: StripeCheckoutSessionInput
  ): Promise<StripeCheckoutSessionResult> {
    const stripe = this.getClient();
    const appUrl =
      this.config.get<string>("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
    const metadata = {
      bookingId: input.bookingId,
      paymentId: input.paymentId
    };

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&bookingId=${encodeURIComponent(
            input.bookingId
          )}`,
          cancel_url: `${appUrl}/checkout/cancel?bookingId=${encodeURIComponent(
            input.bookingId
          )}`,
          client_reference_id: input.bookingId,
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
          metadata,
          payment_intent_data: {
            metadata,
            ...(input.transferGroup
              ? { transfer_group: input.transferGroup }
              : {})
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.amountCents,
                product_data: {
                  name: input.listingTitle
                }
              }
            }
          ]
        },
        { idempotencyKey: input.idempotencyKey }
      );

      return this.toCheckoutSessionResult(session, input.expiresAt);
    } catch {
      throw this.checkoutFailure();
    }
  }

  async retrieveCheckoutSession(sessionId: string) {
    try {
      return await this.getClient().checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.latest_charge"]
      });
    } catch {
      throw this.checkoutFailure();
    }
  }

  async expireCheckoutSession(input: {
    checkoutSessionId: string;
    idempotencyKey: string;
  }) {
    try {
      return await this.getClient().checkout.sessions.expire(
        input.checkoutSessionId,
        {},
        { idempotencyKey: input.idempotencyKey }
      );
    } catch {
      throw this.providerUnavailable();
    }
  }

  async createFullRefund(input: StripeFullRefundInput) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw this.providerUnavailable();
    }
    try {
      return await this.getClient().refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amountCents,
          metadata: {
            bookingId: input.bookingId,
            paymentId: input.paymentId,
            cancellationOperationId: input.cancellationOperationId
          }
        },
        { idempotencyKey: input.idempotencyKey }
      );
    } catch {
      throw this.providerUnavailable();
    }
  }

  async retrievePaymentIntent(paymentIntentId: string) {
    try {
      return await this.getClient().paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"]
      });
    } catch {
      throw this.checkoutFailure();
    }
  }

  async retrieveCharge(chargeId: string) {
    try {
      return await this.getClient().charges.retrieve(chargeId);
    } catch {
      throw this.checkoutFailure();
    }
  }

  async retrieveCheckoutSessionForReconciliation(sessionId: string) {
    try {
      return await this.getClient().checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent", "payment_intent.latest_charge"]
      });
    } catch (error) {
      throw this.reconciliationFailure(error);
    }
  }

  async retrievePaymentIntentForReconciliation(paymentIntentId: string) {
    try {
      return await this.getClient().paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"]
      });
    } catch (error) {
      throw this.reconciliationFailure(error);
    }
  }

  async findDisputesForReconciliation(paymentIntentId: string) {
    try {
      const disputes = await this.getClient().disputes.list({
        payment_intent: paymentIntentId,
        limit: 2
      });
      return disputes.data;
    } catch (error) {
      throw this.reconciliationFailure(error);
    }
  }

  async retrieveHostTransferForReconciliation(transferId: string) {
    try {
      return await this.getClient().transfers.retrieve(transferId, {
        expand: ["reversals"]
      });
    } catch (error) {
      throw this.reconciliationFailure(error);
    }
  }

  async findHostTransfersForReconciliation(transferGroup: string) {
    try {
      const transfers = await this.getClient().transfers.list({
        transfer_group: transferGroup,
        limit: 2
      });
      return transfers.data;
    } catch (error) {
      throw this.reconciliationFailure(error);
    }
  }

  async createRecipientAccount(input: StripeRecipientAccountInput) {
    try {
      return await this.getClient().v2.core.accounts.create(
        {
          contact_email: input.email,
          display_name: input.displayName,
          dashboard: "express",
          defaults: {
            responsibilities: {
              fees_collector: "application",
              losses_collector: "application"
            }
          },
          identity: { country: input.country.toLowerCase() },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: {
                  stripe_transfers: { requested: true }
                }
              }
            }
          },
          metadata: { medicnUserId: input.userId },
          include: [
            "configuration.recipient",
            "defaults",
            "identity",
            "requirements"
          ]
        },
        { idempotencyKey: input.idempotencyKey }
      );
    } catch {
      throw this.connectFailure();
    }
  }

  async retrieveRecipientAccount(providerAccountId: string) {
    try {
      return await this.getClient().v2.core.accounts.retrieve(
        providerAccountId,
        {
          include: [
            "configuration.recipient",
            "defaults",
            "identity",
            "requirements"
          ]
        }
      );
    } catch {
      throw this.connectFailure();
    }
  }

  async createRecipientAccountLink(
    providerAccountId: string,
    type: "account_onboarding" | "account_update"
  ) {
    const appUrl =
      this.config.get<string>("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
    const useCase =
      type === "account_onboarding"
        ? {
            type,
            account_onboarding: {
              configurations: ["recipient" as const],
              collection_options: {
                fields: "eventually_due" as const,
                future_requirements: "include" as const
              },
              refresh_url: `${appUrl}/host/connect/refresh`,
              return_url: `${appUrl}/host/connect/return`
            }
          }
        : {
            type,
            account_update: {
              configurations: ["recipient" as const],
              collection_options: {
                fields: "eventually_due" as const,
                future_requirements: "include" as const
              },
              refresh_url: `${appUrl}/host/connect/refresh`,
              return_url: `${appUrl}/host/connect/return`
            }
          };

    try {
      const link = await this.getClient().v2.core.accountLinks.create({
        account: providerAccountId,
        use_case: useCase
      });
      return {
        url: link.url,
        expiresAt: new Date(link.expires_at).toISOString(),
        type
      };
    } catch {
      throw this.connectFailure();
    }
  }

  async createHostTransfer(input: {
    amountCents: number;
    currency: string;
    destination: string;
    sourceChargeId: string;
    transferGroup: string;
    bookingId: string;
    hostTransferId: string;
    idempotencyKey: string;
  }) {
    try {
      return await this.getClient().transfers.create(
        {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          destination: input.destination,
          source_transaction: input.sourceChargeId,
          transfer_group: input.transferGroup,
          metadata: {
            bookingId: input.bookingId,
            hostTransferId: input.hostTransferId
          }
        },
        { idempotencyKey: input.idempotencyKey }
      );
    } catch {
      throw this.transferFailure();
    }
  }

  async createHostTransferReversal(input: {
    transferId: string;
    amountCents: number;
    bookingId: string;
    hostTransferId: string;
    idempotencyKey: string;
  }) {
    try {
      return await this.getClient().transfers.createReversal(
        input.transferId,
        {
          amount: input.amountCents,
          metadata: {
            bookingId: input.bookingId,
            hostTransferId: input.hostTransferId
          }
        },
        { idempotencyKey: input.idempotencyKey }
      );
    } catch {
      throw this.transferFailure();
    }
  }

  constructWebhookEvent(
    rawBody: Buffer,
    signatureHeader: string | undefined
  ): Stripe.Event {
    const webhookSecret = this.config.get<string>("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret || !signatureHeader) {
      throw this.invalidSignature();
    }

    try {
      return this.getWebhookClient().webhooks.constructEvent(
        rawBody,
        signatureHeader,
        webhookSecret
      );
    } catch {
      throw this.invalidSignature();
    }
  }

  private getClient() {
    if (this.stripe) {
      return this.stripe;
    }

    const secretKey = this.config.get<string>("STRIPE_SECRET_KEY");
    if (!secretKey) {
      throw new InternalServerErrorException({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe is not configured.",
        details: {}
      });
    }

    this.stripe = this.createClient(secretKey);
    return this.stripe;
  }

  private getWebhookClient() {
    return this.stripe ?? this.createClient("sk_test_webhook_validation_only");
  }

  private createClient(secretKey: string) {
    return new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 10_000
    });
  }

  private toCheckoutSessionResult(
    session: Stripe.Checkout.Session,
    fallbackExpiresAt: Date
  ): StripeCheckoutSessionResult {
    if (!session.url) {
      throw this.checkoutFailure();
    }

    return {
      id: session.id,
      url: session.url,
      paymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : fallbackExpiresAt
    };
  }

  private checkoutFailure() {
    return new InternalServerErrorException({
      code: "PAYMENT_FAILED",
      message: "Could not communicate with Stripe safely.",
      details: {}
    });
  }

  private providerUnavailable() {
    return new InternalServerErrorException({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      message: "The payment provider operation could not be completed safely.",
      details: {}
    });
  }

  private connectFailure() {
    return new InternalServerErrorException({
      code: "CONNECT_ONBOARDING_REQUIRED",
      message: "Stripe Connect could not complete the requested account operation.",
      details: {}
    });
  }

  private transferFailure() {
    return new InternalServerErrorException({
      code: "TRANSFER_FAILED",
      message: "Stripe could not create the transfer operation safely.",
      details: {}
    });
  }

  private invalidSignature() {
    return new UnauthorizedException({
      code: "WEBHOOK_SIGNATURE_INVALID",
      message: "Stripe webhook signature is invalid.",
      details: {}
    });
  }

  private reconciliationFailure(error: unknown) {
    const provider = this.providerError(error);
    if (
      provider.type === "StripeInvalidRequestError" &&
      provider.code === "resource_missing"
    ) {
      return new OperationalError(
        "stripe_resource_missing",
        "The configured Stripe object was not found.",
        false
      );
    }
    if (provider.type === "StripeInvalidRequestError") {
      return new OperationalError(
        "stripe_request_invalid",
        "Stripe rejected the reconciliation lookup.",
        false
      );
    }
    if (provider.type === "StripeRateLimitError" || provider.statusCode === 429) {
      return new OperationalError(
        "stripe_rate_limited",
        "Stripe reconciliation is temporarily rate limited.",
        true
      );
    }
    if (
      provider.type === "StripeConnectionError" ||
      provider.type === "StripeAPIError"
    ) {
      return new OperationalError(
        "stripe_provider_unavailable",
        "Stripe reconciliation is temporarily unavailable.",
        true
      );
    }
    if (this.errorCode(error) === "INTERNAL_SERVER_ERROR") {
      return new OperationalError(
        "stripe_configuration_unavailable",
        "Stripe reconciliation is not configured.",
        false
      );
    }
    return new OperationalError(
      "stripe_provider_unavailable",
      "Stripe reconciliation could not complete safely.",
      true
    );
  }

  private providerError(error: unknown) {
    if (typeof error !== "object" || error === null) {
      return { type: null, code: null, statusCode: null };
    }
    const value = error as {
      type?: unknown;
      code?: unknown;
      statusCode?: unknown;
    };
    return {
      type: typeof value.type === "string" ? value.type : null,
      code: typeof value.code === "string" ? value.code : null,
      statusCode: typeof value.statusCode === "number" ? value.statusCode : null
    };
  }

  private errorCode(error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "getResponse" in error &&
      typeof error.getResponse === "function"
    ) {
      const response = error.getResponse();
      if (typeof response === "object" && response !== null && "code" in response) {
        return String(response.code);
      }
    }
    return null;
  }
}
