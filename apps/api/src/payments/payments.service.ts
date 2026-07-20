import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BookingCancellationReason,
  BookingStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus,
  Prisma,
  StripeWebhookProcessingStatus,
  type Payment,
  type ConnectedAccount,
  type User
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { AuthService } from "../auth/auth.service";
import { EmailService } from "../email/email.service";
import { IdentityEligibilityService } from "../identity/identity-eligibility.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateCheckoutSessionDto } from "./dto/create-checkout-session.dto";
import { PaymentTransitionService } from "./payment-transition.service";
import { StripeService } from "./stripe.service";
import { ConnectService } from "./connect.service";
import {
  calculateHostReversalTarget,
  calculateMarketplaceAmounts
} from "./marketplace-money";
import { BookingCancellationsService } from "./booking-cancellations.service";
import { OperationalError } from "../jobs/operational-error";

const paymentInclude = {
  booking: {
    include: {
      renter: { select: { email: true } },
      listing: {
        select: {
          title: true,
          address: true,
          latitude: true,
          longitude: true,
          location: { select: { verifiedAddressVersion: true } }
        }
      }
    }
  },
  hostTransfer: true
} satisfies Prisma.PaymentInclude;

const STRIPE_EXPIRY_SAFETY_MS = 60_000;

type PaymentWithBooking = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

interface StoredStripeEvent {
  id: string;
  type: string;
  created: number;
  object: Record<string, unknown>;
}

interface PreparedCheckoutAttempt {
  expired: boolean;
  booking?: {
    id: string;
    title: string;
    amountCents: number;
    currency: string;
    transferGroup?: string;
  };
  payment?: Payment;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly stripeService: StripeService,
    private readonly transitions: PaymentTransitionService,
    private readonly config: ConfigService,
    private readonly connectService: ConnectService,
    private readonly identityEligibility: IdentityEligibilityService,
    @Optional() private readonly cancellations?: BookingCancellationsService
  ) {}

  async reconcilePaymentProviderState(
    paymentId: string,
    commandId: string
  ): Promise<{ outcome: "reconciled" | "skipped"; providerCalls: number }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: paymentInclude
    });
    if (!payment) {
      throw new OperationalError(
        "payment_not_found",
        "The Payment selected for reconciliation no longer exists.",
        false
      );
    }
    if (payment.status === PaymentStatus.refunded) {
      return { outcome: "skipped", providerCalls: 0 };
    }

    let providerCalls = 0;
    let paymentIntent: Stripe.PaymentIntent | null = null;
    if (payment.providerPaymentIntentId) {
      paymentIntent =
        await this.stripeService.retrievePaymentIntentForReconciliation(
          payment.providerPaymentIntentId
        );
      providerCalls += 1;
    } else if (payment.providerCheckoutSessionId) {
      const session =
        await this.stripeService.retrieveCheckoutSessionForReconciliation(
          payment.providerCheckoutSessionId
        );
      providerCalls += 1;
      if (
        session.payment_intent &&
        typeof session.payment_intent === "object" &&
        !("deleted" in session.payment_intent)
      ) {
        paymentIntent = session.payment_intent;
      } else if (typeof session.payment_intent === "string") {
        paymentIntent =
          await this.stripeService.retrievePaymentIntentForReconciliation(
            session.payment_intent
          );
        providerCalls += 1;
      }
    }
    if (!paymentIntent) {
      return { outcome: "skipped", providerCalls };
    }

    this.validateReconciledPaymentIntent(payment, paymentIntent);
    const charge =
      paymentIntent.latest_charge &&
      typeof paymentIntent.latest_charge === "object" &&
      !("deleted" in paymentIntent.latest_charge)
        ? paymentIntent.latest_charge
        : null;
    let dispute: Stripe.Dispute | null = null;
    if (payment.status === PaymentStatus.disputed || charge?.disputed === true) {
      const disputes =
        await this.stripeService.findDisputesForReconciliation(paymentIntent.id);
      providerCalls += 1;
      dispute = disputes[0] ?? null;
    }
    const event = this.paymentReconciliationEvent(
      payment,
      paymentIntent,
      commandId,
      dispute
    );
    if (!event) {
      return { outcome: "skipped", providerCalls };
    }
    if (event.type === "payment_intent.succeeded") {
      // The shared handler re-fetches this object before applying its monotonic
      // transition, so count that bounded provider call as well.
      providerCalls += 1;
    }
    await this.applyReconciliationEvent(event);
    return { outcome: "reconciled", providerCalls };
  }

  async reconcileHostTransferProviderState(
    hostTransferId: string,
    commandId: string
  ): Promise<{ outcome: "reconciled" | "skipped"; providerCalls: number }> {
    const stored = await this.prisma.hostTransfer.findUnique({
      where: { id: hostTransferId },
      include: { payment: { include: paymentInclude } }
    });
    if (!stored) {
      throw new OperationalError(
        "host_transfer_not_found",
        "The HostTransfer selected for reconciliation no longer exists.",
        false
      );
    }
    if (
      stored.status === HostTransferStatus.transferred &&
      stored.reversalStatus === HostTransferReversalStatus.reversed
    ) {
      return { outcome: "skipped", providerCalls: 0 };
    }

    let transfer: Stripe.Transfer;
    if (stored.providerTransferId) {
      transfer =
        await this.stripeService.retrieveHostTransferForReconciliation(
          stored.providerTransferId
        );
    } else {
      const matches =
        await this.stripeService.findHostTransfersForReconciliation(
          stored.transferGroup
        );
      if (matches.length === 0) {
        return { outcome: "skipped", providerCalls: 1 };
      }
      const match = matches[0];
      if (matches.length !== 1 || !match) {
        throw new OperationalError(
          "host_transfer_provider_match_ambiguous",
          "Provider reconciliation returned an ambiguous Host transfer match.",
          false
        );
      }
      transfer = match;
    }
    this.validateReconciledHostTransfer(stored, transfer);

    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, stored.payment);
      const current = await transaction.hostTransfer.findUnique({
        where: { id: stored.id }
      });
      if (!current) {
        throw new Error("Host transfer disappeared during reconciliation.");
      }
      if (
        current.providerTransferId &&
        current.providerTransferId !== transfer.id
      ) {
        throw new OperationalError(
          "host_transfer_provider_reference_conflict",
          "The stored Host transfer provider reference conflicts with reconciliation.",
          false
        );
      }
      await transaction.hostTransfer.updateMany({
        where: {
          id: current.id,
          status: {
            in: [
              HostTransferStatus.pending,
              HostTransferStatus.processing,
              HostTransferStatus.failed
            ]
          }
        },
        data: {
          providerTransferId: transfer.id,
          status: HostTransferStatus.transferred,
          transferredAt: current.transferredAt ?? new Date(),
          failedAt: null,
          failureCode: null,
          failureMessage: null
        }
      });
    });

    if (transfer.reversed || transfer.amount_reversed > 0) {
      await this.applyReconciliationEvent({
        id: `reconcile-transfer:${commandId}:${stored.id}`,
        type: "transfer.reversed",
        created: Math.floor(Date.now() / 1000),
        object: {
          id: transfer.id,
          amount_reversed: transfer.amount_reversed,
          reversed: transfer.reversed,
          reversals: {
            data: transfer.reversals?.data.map((reversal) => ({
              id: reversal.id
            })) ?? []
          }
        }
      });
    }
    return { outcome: "reconciled", providerCalls: 1 };
  }

  async createCheckoutSession(token: string, input: CreateCheckoutSessionDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertEmailVerified(currentUser);
    await this.identityEligibility.assertApproved(currentUser.id);
    await this.assertCheckoutOwner(currentUser.id, input.bookingId);
    const connectedAccount =
      await this.connectService.requireTransferReadyForBooking(input.bookingId);

    const prepared = await this.prepareCheckoutAttempt(
      currentUser,
      input.bookingId,
      connectedAccount
    );
    if (prepared.expired || !prepared.booking || !prepared.payment) {
      throw this.bookingNotAvailable(
        "The previous payment window expired. Create a new booking request."
      );
    }

    const { booking, payment } = prepared;
    await this.identityEligibility.assertApproved(currentUser.id);
    const checkoutSession = payment.providerCheckoutSessionId
      ? this.toCheckoutResult(
          await this.stripeService.retrieveCheckoutSession(
            payment.providerCheckoutSessionId
          ),
          payment.expiresAt
        )
      : await this.stripeService.createCheckoutSession({
          bookingId: booking.id,
          paymentId: payment.id,
          amountCents: booking.amountCents,
          currency: booking.currency,
          listingTitle: booking.title,
          idempotencyKey: this.requiredAttemptIdempotencyKey(payment),
          expiresAt: this.requiredAttemptExpiry(payment),
          ...(booking.transferGroup
            ? { transferGroup: booking.transferGroup }
            : {})
        });

    await this.finalizeCheckoutAttempt(
      booking.id,
      payment.id,
      checkoutSession
    );

    return {
      checkoutSessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      expiresAt: checkoutSession.expiresAt.toISOString()
    };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    const stripeEvent = this.stripeService.constructWebhookEvent(
      rawBody,
      signature
    );
    const event = this.toStoredStripeEvent(stripeEvent);
    const inbox = await this.persistWebhookEvent(event);

    if (inbox.duplicate) {
      return {
        received: true,
        type: event.type,
        duplicate: true,
        processingStatus: inbox.status
      };
    }

    const processingStatus = await this.processWebhookEvent(inbox.id, event);
    return {
      received: true,
      type: event.type,
      duplicate: false,
      processingStatus
    };
  }

  async retryFailedWebhookEvents(limit = 25) {
    await this.prisma.stripeWebhookEvent.updateMany({
      where: {
        status: StripeWebhookProcessingStatus.processing,
        receivedAt: { lte: new Date(Date.now() - 5 * 60_000) }
      },
      data: {
        status: StripeWebhookProcessingStatus.failed,
        lastError: "Recovered a stale webhook processing claim."
      }
    });
    const events = await this.prisma.stripeWebhookEvent.findMany({
      where: {
        status: {
          in: [
            StripeWebhookProcessingStatus.received,
            StripeWebhookProcessingStatus.failed
          ]
        }
      },
      orderBy: { receivedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 100)
    });
    let processed = 0;
    let failed = 0;

    for (const inbox of events) {
      const status = await this.processWebhookEvent(
        inbox.id,
        inbox.payload as unknown as StoredStripeEvent,
        inbox.status === StripeWebhookProcessingStatus.failed
      );
      if (
        status === StripeWebhookProcessingStatus.processed ||
        status === StripeWebhookProcessingStatus.ignored
      ) {
        processed += 1;
      } else {
        failed += 1;
      }
    }

    return { total: events.length, processed, failed };
  }

  async expireStaleCheckoutAttempts(limit = 100) {
    const candidates = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.pending,
        active: true,
        expiresAt: { lte: new Date() }
      },
      orderBy: { expiresAt: "asc" },
      select: {
        id: true,
        bookingId: true,
        booking: { select: { listingId: true } }
      },
      take: Math.min(Math.max(limit, 1), 500)
    });
    let expired = 0;

    for (const candidate of candidates) {
      const didExpire = await this.prisma.$transaction(async (transaction) => {
        await this.lockAggregate(transaction, candidate.booking.listingId);
        await this.lockAggregate(transaction, `booking:${candidate.bookingId}`);
        await this.lockAggregate(
          transaction,
          `checkout:${candidate.bookingId}`
        );
        await this.lockAggregate(transaction, `payment:${candidate.id}`);
        const payment = await transaction.payment.findUnique({
          where: { id: candidate.id },
          include: paymentInclude
        });
        if (
          !payment ||
          !payment.active ||
          payment.status !== PaymentStatus.pending ||
          !payment.expiresAt ||
          payment.expiresAt > new Date()
        ) {
          return false;
        }

        await transaction.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.expired,
            active: false,
            failureReason: "local_checkout_expiry"
          }
        });
        await this.cancelBookingForPaymentFailure(
          transaction,
          payment.booking,
          BookingCancellationReason.payment_expired,
          payment.id,
          "payment_expired_renter"
        );
        return true;
      });
      if (didExpire) {
        expired += 1;
      }
    }

    return { scanned: candidates.length, expired };
  }

  private async prepareCheckoutAttempt(
    currentUser: User,
    bookingId: string,
    connectedAccount: ConnectedAccount | null
  ): Promise<PreparedCheckoutAttempt> {
    const candidate = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { listingId: true }
    });
    if (!candidate) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Booking was not found.",
        details: {}
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      await this.lockAggregate(transaction, candidate.listingId);
      await this.lockAggregate(transaction, `booking:${bookingId}`);
      await this.lockAggregate(transaction, `checkout:${bookingId}`);
      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        include: {
          listing: { select: { title: true } },
          renter: { select: { email: true } }
        }
      });

      if (!booking) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Booking was not found.",
          details: {}
        });
      }

      if (booking.renterId !== currentUser.id) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: "Only the booking renter can pay for this booking.",
          details: {}
        });
      }

      if (
        connectedAccount &&
        (connectedAccount.userId !== booking.hostId ||
          !connectedAccount.transfersReady)
      ) {
        throw new UnprocessableEntityException({
          code: "HOST_PAYOUT_ACCOUNT_NOT_READY",
          message: "The listing Host must complete Stripe onboarding before checkout.",
          details: {}
        });
      }

      if (
        booking.status !== BookingStatus.accepted &&
        booking.status !== BookingStatus.payment_pending
      ) {
        throw this.bookingNotAvailable(
          "Booking must be accepted before checkout can start."
        );
      }

      const activeAttempt = await transaction.payment.findFirst({
        where: {
          bookingId,
          active: true,
          status: PaymentStatus.pending
        },
        orderBy: { attemptNumber: "desc" }
      });
      const now = new Date();

      if (activeAttempt) {
        if (activeAttempt.expiresAt && activeAttempt.expiresAt > now) {
          const existingTransfer = connectedAccount
            ? await transaction.hostTransfer.findUnique({
                where: { paymentId: activeAttempt.id }
              })
            : null;
          if (connectedAccount && !existingTransfer) {
            throw new Error("Active Connect checkout is missing its fee snapshot.");
          }
          return {
            expired: false,
            booking: {
              id: booking.id,
              title: booking.listing.title,
              amountCents: booking.totalAmountCents,
              currency: booking.currency,
              ...(existingTransfer
                ? { transferGroup: existingTransfer.transferGroup }
                : {})
            },
            payment: activeAttempt
          };
        }

        await transaction.payment.update({
          where: { id: activeAttempt.id },
          data: {
            status: PaymentStatus.expired,
            active: false,
            failureReason: "checkout_session_expired"
          }
        });
        await this.cancelBookingForPaymentFailure(
          transaction,
          booking,
          BookingCancellationReason.payment_expired,
          activeAttempt.id,
          "payment_expired_renter"
        );
        return { expired: true };
      }

      if (booking.status === BookingStatus.payment_pending) {
        throw this.bookingNotAvailable(
          "This booking no longer has an active Checkout attempt."
        );
      }

      const aggregate = await transaction.payment.aggregate({
        where: { bookingId },
        _max: { attemptNumber: true }
      });
      const attemptNumber = (aggregate._max.attemptNumber ?? 0) + 1;
      const expiresAt = new Date(
        now.getTime() +
          this.checkoutTtlMinutes() * 60_000 +
          STRIPE_EXPIRY_SAFETY_MS
      );
      const payment = await transaction.payment.create({
        data: {
          bookingId,
          provider: "stripe",
          attemptNumber,
          idempotencyKey: `checkout:${bookingId}:${attemptNumber}:${randomUUID()}`,
          amountCents: booking.totalAmountCents,
          currency: booking.currency,
          status: PaymentStatus.pending,
          active: true,
          expiresAt
        }
      });

      let transferGroup: string | undefined;
      if (connectedAccount) {
        const { platformFeeBps, transferDelayHours } =
          this.connectService.marketplaceConfiguration();
        const amounts = calculateMarketplaceAmounts(
          booking.totalAmountCents,
          platformFeeBps
        );
        transferGroup = `booking_${booking.id}`;
        await transaction.hostTransfer.create({
          data: {
            bookingId: booking.id,
            paymentId: payment.id,
            hostId: booking.hostId,
            connectedAccountId: connectedAccount.id,
            providerConnectedAccountId: connectedAccount.providerAccountId,
            ...amounts,
            currency: booking.currency.toUpperCase(),
            transferGroup,
            idempotencyKey: `host-transfer:${booking.id}:${payment.id}`,
            eligibleAt: new Date(
              booking.startDate.getTime() + transferDelayHours * 60 * 60_000
            )
          }
        });
      }

      return {
        expired: false,
        booking: {
          id: booking.id,
          title: booking.listing.title,
          amountCents: booking.totalAmountCents,
          currency: booking.currency,
          ...(transferGroup ? { transferGroup } : {})
        },
        payment
      };
    });
  }

  private async assertCheckoutOwner(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { renterId: true }
    });
    if (!booking) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Booking was not found.",
        details: {}
      });
    }
    if (booking.renterId !== userId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only the booking renter can pay for this booking.",
        details: {}
      });
    }
  }

  private async finalizeCheckoutAttempt(
    bookingId: string,
    paymentId: string,
    session: {
      id: string;
      paymentIntentId: string | null;
      expiresAt: Date;
    }
  ) {
    const candidate = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { listingId: true }
    });
    if (!candidate) throw this.bookingNotAvailable("Booking was not found.");
    await this.prisma.$transaction(async (transaction) => {
      await this.lockAggregate(transaction, candidate.listingId);
      await this.lockAggregate(transaction, `booking:${bookingId}`);
      await this.lockAggregate(transaction, `checkout:${bookingId}`);
      await this.lockAggregate(transaction, `payment:${paymentId}`);
      await transaction.payment.updateMany({
        where: {
          id: paymentId,
          bookingId,
          active: true,
          status: PaymentStatus.pending
        },
        data: {
          providerCheckoutSessionId: session.id,
          providerPaymentIntentId: session.paymentIntentId,
          expiresAt: session.expiresAt
        }
      });
      await transaction.booking.updateMany({
        where: {
          id: bookingId,
          status: {
            in: [BookingStatus.accepted, BookingStatus.payment_pending]
          }
        },
        data: { status: BookingStatus.payment_pending }
      });
    });
  }

  private async persistWebhookEvent(event: StoredStripeEvent) {
    try {
      const created = await this.prisma.stripeWebhookEvent.create({
        data: {
          providerEventId: event.id,
          eventType: event.type,
          providerObjectId: this.stringValue(event.object.id),
          payload: event as unknown as Prisma.InputJsonValue
        }
      });
      return {
        id: created.id,
        duplicate: false,
        status: created.status
      };
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.prisma.stripeWebhookEvent.findUnique({
        where: { providerEventId: event.id }
      });
      if (!existing) {
        throw error;
      }

      return {
        id: existing.id,
        duplicate: true,
        status: existing.status
      };
    }
  }

  private paymentReconciliationEvent(
    payment: PaymentWithBooking,
    paymentIntent: Stripe.PaymentIntent,
    commandId: string,
    providerDispute: Stripe.Dispute | null
  ): StoredStripeEvent | null {
    const observedAt = Math.floor(Date.now() / 1000);
    const charge =
      paymentIntent.latest_charge &&
      typeof paymentIntent.latest_charge === "object" &&
      !("deleted" in paymentIntent.latest_charge)
        ? paymentIntent.latest_charge
        : null;
    const dispute = providerDispute as unknown as Record<string, unknown> | null;
    const metadata = {
      bookingId: payment.bookingId,
      paymentId: payment.id
    };

    if (dispute) {
      const disputeStatus = this.stringValue(dispute.status);
      return {
        id: `reconcile-dispute:${commandId}:${payment.id}`,
        type:
          disputeStatus === "won" || disputeStatus === "lost"
            ? "charge.dispute.closed"
            : "charge.dispute.created",
        created: observedAt,
        object: {
          id: this.stringValue(dispute.id),
          status: disputeStatus,
          amount: this.numberValue(dispute.amount),
          currency: this.stringValue(dispute.currency),
          payment_intent: paymentIntent.id,
          metadata
        }
      };
    }
    if (charge && charge.amount_refunded > 0) {
      return {
        id: `reconcile-refund:${commandId}:${payment.id}`,
        type: "charge.refunded",
        created: observedAt,
        object: {
          id: charge.id,
          amount: charge.amount,
          amount_refunded: charge.amount_refunded,
          currency: charge.currency,
          payment_intent: paymentIntent.id,
          metadata
        }
      };
    }
    if (payment.status === PaymentStatus.disputed) {
      return null;
    }
    if (paymentIntent.status === "succeeded") {
      return {
        id: `reconcile-payment:${commandId}:${payment.id}`,
        type: "payment_intent.succeeded",
        created: observedAt,
        object: { id: paymentIntent.id, metadata }
      };
    }
    if (
      paymentIntent.status === "canceled" ||
      paymentIntent.status === "requires_payment_method"
    ) {
      return {
        id: `reconcile-payment-failure:${commandId}:${payment.id}`,
        type: "payment_intent.payment_failed",
        created: observedAt,
        object: { id: paymentIntent.id, metadata }
      };
    }
    return null;
  }

  private async applyReconciliationEvent(event: StoredStripeEvent) {
    const persisted = await this.persistWebhookEvent(event);
    const status = persisted.duplicate
      ? persisted.status === StripeWebhookProcessingStatus.failed
        ? await this.processWebhookEvent(persisted.id, event, true)
        : persisted.status
      : await this.processWebhookEvent(persisted.id, event);
    if (status === StripeWebhookProcessingStatus.failed) {
      throw new OperationalError(
        "reconciliation_transition_failed",
        "The provider snapshot could not be applied to the durable financial state.",
        true
      );
    }
  }

  private validateReconciledHostTransfer(
    stored: {
      id: string;
      bookingId: string;
      providerTransferId: string | null;
      providerConnectedAccountId: string;
      hostNetAmountCents: number;
      currency: string;
      transferGroup: string;
    },
    transfer: Stripe.Transfer
  ) {
    const destination = this.providerReference(transfer.destination);
    const metadataHostTransferId = this.stringValue(
      transfer.metadata?.hostTransferId
    );
    const metadataBookingId = this.stringValue(transfer.metadata?.bookingId);
    if (
      (stored.providerTransferId && stored.providerTransferId !== transfer.id) ||
      transfer.amount !== stored.hostNetAmountCents ||
      transfer.currency.toUpperCase() !== stored.currency.toUpperCase() ||
      destination !== stored.providerConnectedAccountId ||
      transfer.transfer_group !== stored.transferGroup ||
      (metadataHostTransferId && metadataHostTransferId !== stored.id) ||
      (metadataBookingId && metadataBookingId !== stored.bookingId)
    ) {
      throw new OperationalError(
        "host_transfer_provider_validation_failed",
        "The provider Host transfer snapshot did not match the durable record.",
        false
      );
    }
  }

  private async processWebhookEvent(
    inboxId: string,
    event: StoredStripeEvent,
    retryFailed = false
  ): Promise<StripeWebhookProcessingStatus> {
    const claimed = await this.prisma.stripeWebhookEvent.updateMany({
      where: {
        id: inboxId,
        status: retryFailed
          ? StripeWebhookProcessingStatus.failed
          : StripeWebhookProcessingStatus.received
      },
      data: {
        status: StripeWebhookProcessingStatus.processing,
        processingAttempts: { increment: 1 },
        lastError: null
      }
    });
    if (claimed.count !== 1) {
      const existing = await this.prisma.stripeWebhookEvent.findUnique({
        where: { id: inboxId },
        select: { status: true }
      });
      return existing?.status ?? StripeWebhookProcessingStatus.failed;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          return await this.processCheckoutPaid(inboxId, event);
        case "payment_intent.succeeded":
          return await this.processPaymentIntentPaid(inboxId, event);
        case "checkout.session.expired":
          return await this.processCheckoutFailure(
            inboxId,
            event,
            PaymentStatus.expired,
            BookingCancellationReason.payment_expired
          );
        case "checkout.session.async_payment_failed":
          return await this.processCheckoutFailure(
            inboxId,
            event,
            PaymentStatus.failed,
            BookingCancellationReason.payment_failed
          );
        case "payment_intent.payment_failed":
          return await this.processPaymentIntentFailure(inboxId, event);
        case "charge.refunded":
          return await this.processRefund(inboxId, event);
        case "charge.dispute.created":
          return await this.processDisputeCreated(inboxId, event);
        case "charge.dispute.closed":
          return await this.processDisputeClosed(inboxId, event);
        case "transfer.reversed":
          return await this.processTransferReversed(inboxId, event);
        default:
          await this.markInbox(inboxId, StripeWebhookProcessingStatus.ignored);
          return StripeWebhookProcessingStatus.ignored;
      }
    } catch (error) {
      await this.prisma.stripeWebhookEvent.updateMany({
        where: { id: inboxId },
        data: {
          status: StripeWebhookProcessingStatus.failed,
          lastError: this.safeError(error)
        }
      });
      return StripeWebhookProcessingStatus.failed;
    }
  }

  private async processCheckoutPaid(
    inboxId: string,
    event: StoredStripeEvent
  ) {
    const sessionId = this.requiredStringValue(event.object.id, "session id");
    const payment = await this.prisma.payment.findUnique({
      where: { providerCheckoutSessionId: sessionId },
      include: paymentInclude
    });
    if (!payment) {
      throw new Error("Stored payment attempt was not found for Checkout Session.");
    }

    const session = await this.stripeService.retrieveCheckoutSession(sessionId);
    if (session.payment_status !== "paid") {
      await this.markInbox(inboxId, StripeWebhookProcessingStatus.ignored);
      return StripeWebhookProcessingStatus.ignored;
    }
    this.validateCheckoutSession(payment, session);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const providerChargeId =
      typeof session.payment_intent === "object" && session.payment_intent
        ? this.providerReference(session.payment_intent.latest_charge)
        : null;

    return this.applyPaidTransition(
      inboxId,
      event,
      payment,
      paymentIntentId,
      providerChargeId
    );
  }

  private async processPaymentIntentPaid(
    inboxId: string,
    event: StoredStripeEvent
  ) {
    const paymentIntentId = this.requiredStringValue(
      event.object.id,
      "payment intent id"
    );
    const paymentIntent = await this.stripeService.retrievePaymentIntent(
      paymentIntentId
    );
    const payment = await this.findPaymentForPaymentIntent(paymentIntent);
    this.validatePaymentIntent(payment, paymentIntent);

    return this.applyPaidTransition(
      inboxId,
      event,
      payment,
      paymentIntentId,
      this.providerReference(paymentIntent.latest_charge)
    );
  }

  private async applyPaidTransition(
    inboxId: string,
    event: StoredStripeEvent,
    payment: PaymentWithBooking,
    paymentIntentId: string | null,
    providerChargeId: string | null
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, payment);
      const current = await transaction.payment.findUnique({
        where: { id: payment.id },
        include: paymentInclude
      });
      if (!current) {
        throw new Error("Payment disappeared while applying fulfillment.");
      }

      if (
        (current.lastProviderEventCreatedAt &&
          current.lastProviderEventCreatedAt > new Date(event.created * 1000)) ||
        !this.transitions.canTransitionPayment(
          current.status,
          PaymentStatus.paid,
          "provider_payment"
        )
      ) {
        await this.markInboxTransactionally(
          transaction,
          inboxId,
          StripeWebhookProcessingStatus.processed
        );
        return;
      }

      const now = new Date();
      await transaction.payment.update({
        where: { id: current.id },
        data: {
          providerPaymentIntentId: paymentIntentId,
          ...(providerChargeId ? { providerChargeId } : {}),
          status: PaymentStatus.paid,
          active: false,
          paidAt: current.paidAt ?? now,
          failureReason: null,
          lastProviderEventId: event.id,
          lastProviderEventCreatedAt: new Date(event.created * 1000)
        }
      });
      const cancellationPending = this.cancellations
        ? await this.cancellations.reconcilePaymentSettled(
            transaction,
            current.bookingId,
            current.id
          )
        : false;
      const bookingFulfilled =
        !cancellationPending &&
        this.transitions.canTransitionBooking(
          current.booking.status,
          BookingStatus.paid
        );
      if (bookingFulfilled) {
        if (current.booking.listing.address) {
          await transaction.bookingLocationSnapshot.upsert({
            where: { bookingId: current.bookingId },
            create: {
              bookingId: current.bookingId,
              formattedAddress: current.booking.listing.address,
              exactLatitude: current.booking.listing.latitude,
              exactLongitude: current.booking.listing.longitude,
              sourceListingLocationVersion:
                current.booking.listing.location?.verifiedAddressVersion ?? null,
              capturedAt: now
            },
            update: {}
          });
        }
        await transaction.booking.update({
          where: { id: current.bookingId },
          data: { status: BookingStatus.paid }
        });
      }

      if (bookingFulfilled) {
        await this.emailService.queueTransactionalEmail(
          {
            to: current.booking.renter.email,
            template: "payment_succeeded_renter",
            subject: `Payment confirmed for ${current.booking.listing.title}`,
            text: `Your payment for ${current.booking.listing.title} has been confirmed.`,
            metadata: {
              bookingId: current.bookingId,
              paymentId: current.id
            }
          },
          {
            aggregateId: current.bookingId,
            aggregateType: "booking",
            client: transaction,
            deduplicationKey: `payment-succeeded:${current.id}:renter`
          }
        );
      }
      await this.markInboxTransactionally(
        transaction,
        inboxId,
        StripeWebhookProcessingStatus.processed
      );
    });

    return StripeWebhookProcessingStatus.processed;
  }

  private async processCheckoutFailure(
    inboxId: string,
    event: StoredStripeEvent,
    targetStatus: PaymentStatus,
    reason: BookingCancellationReason
  ) {
    const sessionId = this.requiredStringValue(event.object.id, "session id");
    const payment = await this.prisma.payment.findUnique({
      where: { providerCheckoutSessionId: sessionId },
      include: paymentInclude
    });
    if (!payment) {
      throw new Error("Stored payment attempt was not found for Checkout Session.");
    }

    return this.applyFailureTransition(
      inboxId,
      event,
      payment,
      targetStatus,
      reason
    );
  }

  private async processPaymentIntentFailure(
    inboxId: string,
    event: StoredStripeEvent
  ) {
    const paymentIntentId = this.requiredStringValue(
      event.object.id,
      "payment intent id"
    );
    const payment = await this.findPaymentByProviderOrMetadata(
      paymentIntentId,
      this.recordValue(event.object.metadata)
    );
    return this.applyFailureTransition(
      inboxId,
      event,
      payment,
      PaymentStatus.failed,
      BookingCancellationReason.payment_failed
    );
  }

  private async applyFailureTransition(
    inboxId: string,
    event: StoredStripeEvent,
    payment: PaymentWithBooking,
    targetStatus: PaymentStatus,
    reason: BookingCancellationReason
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, payment);
      const current = await transaction.payment.findUnique({
        where: { id: payment.id },
        include: paymentInclude
      });
      if (!current) {
        throw new Error("Payment disappeared while applying failure.");
      }

      if (
        this.transitions.canTransitionPayment(
          current.status,
          targetStatus,
          targetStatus === PaymentStatus.expired
            ? "provider_expiry"
            : "provider_failure"
        )
      ) {
        await transaction.payment.update({
          where: { id: current.id },
          data: {
            status: targetStatus,
            active: false,
            failureReason: event.type,
            lastProviderEventId: event.id,
            lastProviderEventCreatedAt: new Date(event.created * 1000)
          }
        });
        await this.cancelBookingForPaymentFailure(
          transaction,
          current.booking,
          reason,
          current.id,
          targetStatus === PaymentStatus.expired
            ? "payment_expired_renter"
            : "payment_failed_renter"
        );
      }

      await this.markInboxTransactionally(
        transaction,
        inboxId,
        StripeWebhookProcessingStatus.processed
      );
    });
    return StripeWebhookProcessingStatus.processed;
  }

  private async processRefund(inboxId: string, event: StoredStripeEvent) {
    const paymentIntentId = await this.resolveChargePaymentIntent(event.object);
    const payment = await this.findPaymentByProviderOrMetadata(
      paymentIntentId,
      this.recordValue(event.object.metadata)
    );
    const amountRefunded = this.requiredNumberValue(
      event.object.amount_refunded,
      "amount refunded"
    );
    const currency = this.requiredStringValue(event.object.currency, "currency");
    if (currency.toUpperCase() !== payment.currency.toUpperCase()) {
      throw new Error("Refund currency did not match the stored Payment.");
    }
    const chargeAmount = this.numberValue(event.object.amount);
    if (
      amountRefunded > payment.amountCents ||
      (chargeAmount !== null && chargeAmount !== payment.amountCents)
    ) {
      throw new Error("Refund amount did not match the stored Payment.");
    }
    const cumulativeRefund = Math.max(
      payment.amountRefundedCents,
      amountRefunded
    );
    const fullRefund = cumulativeRefund >= payment.amountCents;
    const targetStatus = fullRefund
      ? PaymentStatus.refunded
      : PaymentStatus.partially_refunded;

    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, payment);
      const current = await transaction.payment.findUnique({
        where: { id: payment.id },
        include: paymentInclude
      });
      if (!current) {
        throw new Error("Payment disappeared while applying refund.");
      }
      const nextRefundAmount = Math.max(
        current.amountRefundedCents,
        cumulativeRefund
      );
      const canTransition = this.transitions.canTransitionPayment(
        current.status,
        targetStatus,
        "provider_refund"
      );

      if (canTransition || nextRefundAmount > current.amountRefundedCents) {
        await transaction.payment.update({
          where: { id: current.id },
          data: {
            ...(canTransition ? { status: targetStatus } : {}),
            amountRefundedCents: nextRefundAmount,
            active: false,
            ...(fullRefund
              ? { refundedAt: current.refundedAt ?? new Date() }
              : {}),
            lastProviderEventId: event.id,
            lastProviderEventCreatedAt: new Date(event.created * 1000)
          }
        });
      }

      await this.applyRefundToHostTransfer(
        transaction,
        current.id,
        nextRefundAmount
      );

      if (fullRefund) {
        await this.cancelBooking(
          transaction,
          current.booking,
          BookingCancellationReason.full_refund
        );
        const activeCancellation = this.cancellations
          ? await transaction.bookingCancellationOperation.findFirst({
              where: { bookingId: current.bookingId, active: true },
              select: { id: true }
            })
          : null;
        if (this.cancellations) {
          await this.cancellations.reconcileCancellationEffective(transaction, {
            bookingId: current.bookingId,
            paymentId: current.id,
            reason: "full_refund",
            effectiveAt: new Date()
          });
        }
        if (!activeCancellation && (canTransition || current.refundedAt === null)) {
          await this.emailService.queueTransactionalEmail(
            {
              to: current.booking.renter.email,
              template: "payment_refunded_renter",
              subject: `Refund completed for ${current.booking.listing.title}`,
              text: `Your payment for ${current.booking.listing.title} was fully refunded.`,
              metadata: {
                bookingId: current.bookingId,
                paymentId: current.id
              }
            },
            {
              aggregateId: current.bookingId,
              aggregateType: "booking",
              client: transaction,
              deduplicationKey: `payment-refunded:${current.id}:renter`
            }
          );
        }
      }

      await this.markInboxTransactionally(
        transaction,
        inboxId,
        StripeWebhookProcessingStatus.processed
      );
    });

    return StripeWebhookProcessingStatus.processed;
  }

  private async processDisputeCreated(
    inboxId: string,
    event: StoredStripeEvent
  ) {
    const paymentIntentId = await this.resolveChargePaymentIntent(event.object);
    const payment = await this.findPaymentByProviderOrMetadata(
      paymentIntentId,
      this.recordValue(event.object.metadata)
    );
    this.validateDisputeAmount(payment, event.object);

    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, payment);
      const current = await transaction.payment.findUnique({
        where: { id: payment.id },
        include: paymentInclude
      });
      if (!current) {
        throw new Error("Payment disappeared while applying dispute.");
      }
      const transitioned = this.transitions.canTransitionPayment(
        current.status,
        PaymentStatus.disputed,
        "provider_dispute"
      );
      if (transitioned) {
        await transaction.payment.update({
          where: { id: current.id },
          data: {
            status: PaymentStatus.disputed,
            active: false,
            lastProviderEventId: event.id,
            lastProviderEventCreatedAt: new Date(event.created * 1000)
          }
        });
        await this.cancelBooking(
          transaction,
          current.booking,
          BookingCancellationReason.payment_disputed
        );
        await this.blockUnreleasedHostTransfer(
          transaction,
          current.id,
          "payment_disputed_before_release"
        );
        if (this.cancellations) {
          await this.cancellations.reconcileCancellationEffective(transaction, {
            bookingId: current.bookingId,
            paymentId: current.id,
            reason: "payment_disputed",
            effectiveAt: new Date()
          });
        }

        const operationsEmail = this.config.get<string>(
          "PAYMENTS_OPERATIONS_EMAIL"
        );
        if (operationsEmail) {
          await this.emailService.queueTransactionalEmail(
            {
              to: operationsEmail,
              template: "payment_disputed_admin",
              subject: `Payment dispute for booking ${current.bookingId}`,
              text: `A payment dispute was opened for ${current.booking.listing.title}.`,
              metadata: {
                bookingId: current.bookingId,
                paymentId: current.id
              }
            },
            {
              aggregateId: current.bookingId,
              aggregateType: "booking",
              client: transaction,
              deduplicationKey: `payment-disputed:${current.id}:operations`
            }
          );
        }
      }

      await this.markInboxTransactionally(
        transaction,
        inboxId,
        StripeWebhookProcessingStatus.processed
      );
    });

    return StripeWebhookProcessingStatus.processed;
  }

  private async processTransferReversed(
    inboxId: string,
    event: StoredStripeEvent
  ) {
    const providerTransferId = this.requiredStringValue(
      event.object.id,
      "transfer id"
    );
    const stored = await this.prisma.hostTransfer.findUnique({
      where: { providerTransferId },
      include: { payment: { include: paymentInclude } }
    });
    if (!stored) {
      await this.markInbox(inboxId, StripeWebhookProcessingStatus.ignored);
      return StripeWebhookProcessingStatus.ignored;
    }
    const amountReversed = this.requiredNumberValue(
      event.object.amount_reversed,
      "transfer reversed amount"
    );
    if (amountReversed > stored.hostNetAmountCents) {
      throw new Error("Transfer reversal exceeded the durable Host net amount.");
    }
    const reversalIds = this.transferReversalIds(event.object.reversals);

    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, stored.payment);
      const current = await transaction.hostTransfer.findUnique({
        where: { id: stored.id }
      });
      if (!current) throw new Error("Host transfer disappeared during reversal.");
      const reversedAmountCents = Math.max(
        current.reversedAmountCents,
        amountReversed
      );
      const ids = Array.isArray(current.reversalProviderIds)
        ? current.reversalProviderIds.filter(
            (value): value is string => typeof value === "string"
          )
        : [];
      for (const id of reversalIds) if (!ids.includes(id)) ids.push(id);
      await transaction.hostTransfer.update({
        where: { id: current.id },
        data: {
          reversedAmountCents,
          reversalTargetAmountCents: Math.max(
            current.reversalTargetAmountCents,
            reversedAmountCents
          ),
          reversalProviderIds: ids,
          reversalStatus:
            event.object.reversed === true ||
            reversedAmountCents >= current.hostNetAmountCents
              ? HostTransferReversalStatus.reversed
              : HostTransferReversalStatus.partially_reversed,
          reversalFailureCode: null,
          reversalFailureMessage: null
        }
      });
      if (this.cancellations) {
        await this.cancellations.reconcileTransferReversal(
          transaction,
          current.bookingId,
          new Date()
        );
      }
      await this.markInboxTransactionally(
        transaction,
        inboxId,
        StripeWebhookProcessingStatus.processed
      );
    });
    return StripeWebhookProcessingStatus.processed;
  }

  private async applyRefundToHostTransfer(
    transaction: Prisma.TransactionClient,
    paymentId: string,
    refundedGrossAmountCents: number
  ) {
    const initial = await transaction.hostTransfer.findUnique({
      where: { paymentId }
    });
    if (!initial) return;
    await this.lockAggregate(transaction, `host-transfer:${initial.id}`);
    const transfer = await transaction.hostTransfer.findUnique({
      where: { id: initial.id }
    });
    if (!transfer) return;

    if (
      transfer.providerTransferId &&
      transfer.status === HostTransferStatus.transferred
    ) {
      const target = calculateHostReversalTarget(
        refundedGrossAmountCents,
        transfer.grossAmountCents,
        transfer.hostNetAmountCents
      );
      if (target > transfer.reversalTargetAmountCents) {
        await transaction.hostTransfer.update({
          where: { id: transfer.id },
          data: {
            reversalTargetAmountCents: target,
            reversalStatus:
              target > transfer.reversedAmountCents
                ? HostTransferReversalStatus.pending
                : transfer.reversalStatus
          }
        });
      }
      return;
    }

    if (!transfer.providerTransferId) {
      await transaction.hostTransfer.updateMany({
        where: {
          id: transfer.id,
          providerTransferId: null,
          status: { not: HostTransferStatus.transferred }
        },
        data: {
          status: HostTransferStatus.blocked,
          failureCode: "payment_refunded_before_release",
          failureMessage: "Refunded payments are not eligible for Host transfer."
        }
      });
    }
  }

  private async blockUnreleasedHostTransfer(
    transaction: Prisma.TransactionClient,
    paymentId: string,
    reason: string
  ) {
    const initial = await transaction.hostTransfer.findUnique({
      where: { paymentId }
    });
    if (!initial) return;
    await this.lockAggregate(transaction, `host-transfer:${initial.id}`);
    await transaction.hostTransfer.updateMany({
      where: {
        id: initial.id,
        providerTransferId: null,
        status: { not: HostTransferStatus.transferred }
      },
      data: {
        status: HostTransferStatus.blocked,
        failureCode: reason,
        failureMessage: "Disputed payments are not eligible for Host transfer."
      }
    });
  }

  private transferReversalIds(value: unknown) {
    if (!value || typeof value !== "object" || !("data" in value)) return [];
    const data = (value as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      if (item && typeof item === "object" && "id" in item) {
        const id = this.stringValue(item.id);
        return id ? [id] : [];
      }
      return [];
    });
  }

  private async processDisputeClosed(
    inboxId: string,
    event: StoredStripeEvent
  ) {
    const status = this.stringValue(event.object.status);
    if (status !== "won") {
      await this.markInbox(inboxId, StripeWebhookProcessingStatus.processed);
      return StripeWebhookProcessingStatus.processed;
    }

    const paymentIntentId = await this.resolveChargePaymentIntent(event.object);
    const payment = await this.findPaymentByProviderOrMetadata(
      paymentIntentId,
      this.recordValue(event.object.metadata)
    );
    this.validateDisputeAmount(payment, event.object);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockPaymentState(transaction, payment);
      const current = await transaction.payment.findUnique({
        where: { id: payment.id }
      });
      if (
        current &&
        this.transitions.canTransitionPayment(
          current.status,
          PaymentStatus.paid,
          "dispute_won"
        )
      ) {
        await transaction.payment.update({
          where: { id: current.id },
          data: {
            status: PaymentStatus.paid,
            lastProviderEventId: event.id,
            lastProviderEventCreatedAt: new Date(event.created * 1000)
          }
        });
      }
      await this.markInboxTransactionally(
        transaction,
        inboxId,
        StripeWebhookProcessingStatus.processed
      );
    });
    return StripeWebhookProcessingStatus.processed;
  }

  private async cancelBookingForPaymentFailure(
    transaction: Prisma.TransactionClient,
    booking: {
      id: string;
      status: BookingStatus;
      renter: { email: string };
      listing: { title: string };
    },
    reason: BookingCancellationReason,
    paymentId: string,
    template: "payment_failed_renter" | "payment_expired_renter"
  ) {
    const cancelled = await this.cancelBooking(transaction, booking, reason);
    if (!cancelled) {
      return;
    }

    if (this.cancellations) {
      await this.cancellations.reconcileCancellationEffective(transaction, {
        bookingId: booking.id,
        paymentId,
        reason:
          reason === BookingCancellationReason.payment_expired
            ? "payment_expired"
            : "payment_failed",
        effectiveAt: new Date()
      });
      return;
    }

    await this.emailService.queueTransactionalEmail(
      {
        to: booking.renter.email,
        template,
        subject:
          reason === BookingCancellationReason.payment_expired
            ? `Payment window expired for ${booking.listing.title}`
            : `Payment failed for ${booking.listing.title}`,
        text:
          reason === BookingCancellationReason.payment_expired
            ? `Your payment window for ${booking.listing.title} expired and the dates were released.`
            : `Your payment for ${booking.listing.title} failed and the dates were released.`,
        metadata: { bookingId: booking.id, paymentId }
      },
      {
        aggregateId: booking.id,
        aggregateType: "booking",
        client: transaction,
        deduplicationKey: `${template}:${paymentId}:renter`
      }
    );
  }

  private async cancelBooking(
    transaction: Prisma.TransactionClient,
    booking: { id: string; status: BookingStatus },
    reason: BookingCancellationReason
  ) {
    if (
      !this.transitions.canTransitionBooking(
        booking.status,
        BookingStatus.cancelled
      )
    ) {
      return false;
    }

    const updated = await transaction.booking.updateMany({
      where: {
        id: booking.id,
        status: booking.status
      },
      data: {
        status: BookingStatus.cancelled,
        cancellationReason: reason,
        cancelledAt: new Date()
      }
    });
    return updated.count === 1;
  }

  private validateCheckoutSession(
    payment: PaymentWithBooking,
    session: Stripe.Checkout.Session
  ) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    const paymentIntentTransferGroup =
      typeof session.payment_intent === "object" && session.payment_intent
        ? session.payment_intent.transfer_group
        : null;
    if (
      session.id !== payment.providerCheckoutSessionId ||
      session.status !== "complete" ||
      session.client_reference_id !== payment.bookingId ||
      session.metadata?.bookingId !== payment.bookingId ||
      session.metadata?.paymentId !== payment.id ||
      session.amount_total !== payment.amountCents ||
      session.currency?.toUpperCase() !== payment.currency.toUpperCase() ||
      (payment.providerPaymentIntentId &&
        paymentIntentId !== payment.providerPaymentIntentId) ||
      (payment.hostTransfer &&
        paymentIntentTransferGroup !== payment.hostTransfer.transferGroup)
    ) {
      throw new Error("Checkout Session fulfillment validation failed.");
    }
  }

  private validatePaymentIntent(
    payment: PaymentWithBooking,
    paymentIntent: Stripe.PaymentIntent
  ) {
    if (
      paymentIntent.status !== "succeeded" ||
      paymentIntent.metadata.bookingId !== payment.bookingId ||
      paymentIntent.metadata.paymentId !== payment.id ||
      paymentIntent.amount_received !== payment.amountCents ||
      paymentIntent.currency.toUpperCase() !== payment.currency.toUpperCase() ||
      (payment.providerPaymentIntentId &&
        paymentIntent.id !== payment.providerPaymentIntentId) ||
      (payment.hostTransfer &&
        paymentIntent.transfer_group !== payment.hostTransfer.transferGroup)
    ) {
      throw new Error("PaymentIntent fulfillment validation failed.");
    }
  }

  private validateReconciledPaymentIntent(
    payment: PaymentWithBooking,
    paymentIntent: Stripe.PaymentIntent
  ) {
    if (
      paymentIntent.metadata.bookingId !== payment.bookingId ||
      paymentIntent.metadata.paymentId !== payment.id ||
      paymentIntent.amount !== payment.amountCents ||
      paymentIntent.currency.toUpperCase() !== payment.currency.toUpperCase() ||
      (paymentIntent.status === "succeeded" &&
        paymentIntent.amount_received !== payment.amountCents) ||
      (payment.providerPaymentIntentId &&
        paymentIntent.id !== payment.providerPaymentIntentId) ||
      (payment.hostTransfer &&
        paymentIntent.transfer_group !== payment.hostTransfer.transferGroup)
    ) {
      throw new OperationalError(
        "payment_provider_validation_failed",
        "The provider PaymentIntent snapshot did not match the durable Payment.",
        false
      );
    }
  }

  private async findPaymentForPaymentIntent(
    paymentIntent: Stripe.PaymentIntent
  ) {
    return this.findPaymentByProviderOrMetadata(
      paymentIntent.id,
      paymentIntent.metadata
    );
  }

  private async findPaymentByProviderOrMetadata(
    providerPaymentIntentId: string,
    metadata: Record<string, string> | Record<string, unknown>
  ) {
    const paymentId = this.stringValue(metadata.paymentId);
    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { providerPaymentIntentId },
          ...(paymentId ? [{ id: paymentId }] : [])
        ]
      },
      include: paymentInclude
    });
    if (!payment) {
      throw new Error("Stored payment attempt was not found for PaymentIntent.");
    }
    return payment;
  }

  private async resolveChargePaymentIntent(object: Record<string, unknown>) {
    const direct = this.stringValue(object.payment_intent);
    if (direct) {
      return direct;
    }

    const chargeId = this.requiredStringValue(object.charge ?? object.id, "charge id");
    const charge = await this.stripeService.retrieveCharge(chargeId);
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntentId) {
      throw new Error("Charge did not reference a PaymentIntent.");
    }
    return paymentIntentId;
  }

  private async markInbox(
    inboxId: string,
    status: StripeWebhookProcessingStatus
  ) {
    await this.prisma.stripeWebhookEvent.update({
      where: { id: inboxId },
      data: {
        status,
        processedAt: new Date(),
        lastError: null
      }
    });
  }

  private markInboxTransactionally(
    transaction: Prisma.TransactionClient,
    inboxId: string,
    status: StripeWebhookProcessingStatus
  ) {
    return transaction.stripeWebhookEvent.update({
      where: { id: inboxId },
      data: {
        status,
        processedAt: new Date(),
        lastError: null
      }
    });
  }

  private async lockAggregate(
    transaction: Prisma.TransactionClient,
    aggregateKey: string
  ) {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${aggregateKey}, 0))`
    );
  }

  private async lockPaymentState(
    transaction: Prisma.TransactionClient,
    payment: PaymentWithBooking
  ) {
    await this.lockAggregate(transaction, payment.booking.listingId);
    await this.lockAggregate(transaction, `booking:${payment.bookingId}`);
    await this.lockAggregate(transaction, `checkout:${payment.bookingId}`);
    await this.lockAggregate(transaction, `payment:${payment.id}`);
    if (payment.hostTransfer) {
      await this.lockAggregate(
        transaction,
        `host-transfer:${payment.hostTransfer.id}`
      );
    }
  }

  private toCheckoutResult(
    session: Stripe.Checkout.Session,
    fallbackExpiresAt: Date | null
  ) {
    if (
      session.status !== "open" ||
      !session.url ||
      (!session.expires_at && !fallbackExpiresAt)
    ) {
      throw this.bookingNotAvailable("The Checkout Session is no longer active.");
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
        : (fallbackExpiresAt as Date)
    };
  }

  private toStoredStripeEvent(event: Stripe.Event): StoredStripeEvent {
    const object = event.data.object as unknown as Record<string, unknown>;
    const allowedKeys = [
      "id",
      "payment_status",
      "status",
      "amount_total",
      "amount_received",
      "amount",
      "amount_refunded",
      "amount_reversed",
      "currency",
      "client_reference_id",
      "metadata",
      "payment_intent",
      "charge",
      "refunded",
      "reversed",
      "reversals",
      "expires_at"
    ];
    const minimalObject: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      const value = object[key];
      if (value !== undefined) {
        if (key === "metadata") {
          const metadata = this.recordValue(value);
          minimalObject[key] = {
            bookingId: this.stringValue(metadata.bookingId),
            paymentId: this.stringValue(metadata.paymentId)
          };
        } else if (key === "reversals") {
          minimalObject[key] = {
            data: this.transferReversalIds(value).map((id) => ({ id }))
          };
        } else {
          minimalObject[key] =
            key === "payment_intent" || key === "charge"
              ? this.providerReference(value)
              : value;
        }
      }
    }

    return {
      id: event.id,
      type: event.type,
      created: event.created,
      object: minimalObject
    };
  }

  private providerReference(value: unknown) {
    if (typeof value === "string") {
      return value;
    }
    return this.stringValue(this.recordValue(value).id);
  }

  private checkoutTtlMinutes() {
    return this.config.get<number>("CHECKOUT_SESSION_TTL_MINUTES") ?? 30;
  }

  private requiredAttemptIdempotencyKey(payment: Payment) {
    if (!payment.idempotencyKey) {
      throw new Error("Payment attempt idempotency key is missing.");
    }
    return payment.idempotencyKey;
  }

  private requiredAttemptExpiry(payment: Payment) {
    if (!payment.expiresAt) {
      throw new Error("Payment attempt expiry is missing.");
    }
    return payment.expiresAt;
  }

  private requiredStringValue(value: unknown, label: string) {
    const parsed = this.stringValue(value);
    if (!parsed) {
      throw new Error(`Stripe event ${label} is missing.`);
    }
    return parsed;
  }

  private requiredNumberValue(value: unknown, label: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Stripe event ${label} is invalid.`);
    }
    return value;
  }

  private numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private validateDisputeAmount(
    payment: PaymentWithBooking,
    object: Record<string, unknown>
  ) {
    const amount = this.numberValue(object.amount);
    const currency = this.stringValue(object.currency);
    if (
      (amount !== null && amount > payment.amountCents) ||
      (currency && currency.toUpperCase() !== payment.currency.toUpperCase())
    ) {
      throw new Error("Dispute amount or currency did not match the stored Payment.");
    }
  }

  private stringValue(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private recordValue(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, string>;
  }

  private safeError(error: unknown) {
    return (error instanceof Error ? error.message : "Webhook processing failed.")
      .slice(0, 500);
  }

  private isUniqueViolation(error: unknown) {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002") ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002")
    );
  }

  private assertEmailVerified(user: User) {
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: "EMAIL_NOT_VERIFIED",
        message: "Email verification is required before checkout.",
        details: {}
      });
    }
  }

  private bookingNotAvailable(message: string) {
    return new BadRequestException({
      code: "BOOKING_NOT_AVAILABLE",
      message,
      details: {}
    });
  }
}
