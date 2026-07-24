import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  BookingStatus,
  CancellationActorType,
  CancellationFinancialDisposition,
  CancellationOperationReason,
  CancellationOperationStatus,
  Prisma,
  UserRole,
  type BookingCancellationOperation,
  type User
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import {
  CancellationPolicyError,
  decideCancellationPlan,
  type CancellationRequestActor
} from "../bookings/booking-cancellation-policy";
import {
  BOOKING_CANCELLATION_CHECKOUT_EXPIRY_JOB,
  BOOKING_CANCELLATION_EMAIL_JOB,
  BOOKING_CANCELLATION_FULL_REFUND_JOB,
  type BookingCancellationEmailPayload,
  type BookingCancellationOperationPayload
} from "../bookings/booking-cancellation.types";
import type { CancelBookingDto } from "../bookings/dto/cancel-booking.dto";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "./stripe.service";

const allowedReasons: Record<CancellationRequestActor, ReadonlySet<string>> = {
  renter: new Set(["plans_changed", "booking_no_longer_needed", "other"]),
  host: new Set([
    "property_unavailable",
    "cannot_accommodate",
    "safety_issue",
    "other"
  ]),
  admin: new Set([
    "support_resolution",
    "safety_issue",
    "fraud_risk",
    "provider_failure",
    "other"
  ])
};

@Injectable()
export class BookingCancellationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jobs: JobsService,
    private readonly stripe?: StripeService
  ) {}

  async cancelBooking(
    token: string,
    bookingId: string,
    idempotencyKey: string,
    input: CancelBookingDto
  ) {
    const user = await this.auth.getCurrentUserRecord(token);
    const candidate = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { listingId: true }
    });
    if (!candidate) throw this.notFound();

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, candidate.listingId);
      await this.lock(transaction, `booking:${bookingId}`);
      await this.lock(transaction, `checkout:${bookingId}`);

      let booking = await this.loadBooking(transaction, bookingId);
      if (!booking) throw this.notFound();
      const actorType = this.actorFor(user, booking);
      this.assertReasonAllowed(actorType, input.reason);

      const payment = booking.payments[0] ?? null;
      if (payment) await this.lock(transaction, `payment:${payment.id}`);
      if (booking.hostTransfer) {
        await this.lock(transaction, `host-transfer:${booking.hostTransfer.id}`);
      }
      booking = await this.loadBooking(transaction, bookingId);
      if (!booking) throw this.notFound();

      const existing = await transaction.bookingCancellationOperation.findUnique({
        where: {
          bookingId_idempotencyKey: { bookingId, idempotencyKey }
        }
      });
      if (existing) return this.toResult(booking.status, existing);

      const active = await transaction.bookingCancellationOperation.findFirst({
        where: { bookingId, active: true },
        orderBy: { version: "desc" }
      });
      if (active) {
        throw new ConflictException({
          code: "CANCELLATION_ALREADY_IN_PROGRESS",
          message: "A cancellation operation is already in progress.",
          details: {}
        });
      }

      const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>(
        Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`
      );
      if (!databaseClock) throw new Error("Database current time was unavailable.");
      const currentPayment = booking.payments[0] ?? null;
      const plan = this.plan({
        actorType,
        bookingStatus: booking.status,
        payment: currentPayment,
        futureStay: booking.startDate > databaseClock.now
      });

      if (plan.kind === "existing") {
        const latest = await transaction.bookingCancellationOperation.findFirst({
          where: { bookingId },
          orderBy: { version: "desc" }
        });
        if (!latest) throw new Error("Cancelled booking is missing cancellation history.");
        return this.toResult(booking.status, latest);
      }

      const versions = await transaction.bookingCancellationOperation.aggregate({
        where: { bookingId },
        _max: { version: true }
      });
      const operationState = this.operationState(plan.kind, databaseClock.now);
      const operation = await transaction.bookingCancellationOperation.create({
        data: {
          bookingId,
          paymentId: currentPayment?.id ?? null,
          version: (versions._max.version ?? 0) + 1,
          actorType: CancellationActorType[actorType],
          actorUserId: user.id,
          reason: CancellationOperationReason[input.reason],
          idempotencyKey,
          requestedAt: databaseClock.now,
          ...operationState
        }
      });

      let bookingStatus = booking.status;
      if (plan.kind === "immediate") {
        const updated = await transaction.booking.updateMany({
          where: { id: bookingId, status: booking.status },
          data: {
            status: BookingStatus.cancelled,
            cancellationReason: plan.bookingReason,
            cancelledAt: databaseClock.now
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: "PAYMENT_STATE_CHANGED",
            message: "The booking state changed before cancellation committed.",
            details: {}
          });
        }
        bookingStatus = BookingStatus.cancelled;
      } else {
        const payload: BookingCancellationOperationPayload = {
          cancellationOperationId: operation.id
        };
        await this.jobs.enqueue(
          plan.kind === "checkout_expiry"
            ? BOOKING_CANCELLATION_CHECKOUT_EXPIRY_JOB
            : BOOKING_CANCELLATION_FULL_REFUND_JOB,
          payload,
          {
            aggregateType: "booking_cancellation",
            aggregateId: operation.id,
            client: transaction,
            deduplicationKey: `booking-cancellation:${plan.kind}:${operation.id}`,
            maxAttempts: 5
          }
        );
      }

      await this.queueParticipantNotifications(
        transaction,
        operation,
        actorType,
        booking.renterId,
        booking.hostId,
        plan.kind === "immediate"
          ? "booking_cancelled_no_payment"
          : "booking_cancellation_pending"
      );
      return this.toResult(bookingStatus, operation);
    });
  }

  async executeCheckoutExpiry(operationId: string) {
    const stripe = this.requiredStripe();
    const prepared = await this.prepareProviderOperation(operationId);
    if (!prepared) return { completed: true };
    const { operation, payment } = prepared;
    if (
      operation.status !== CancellationOperationStatus.checkout_expiry_pending &&
      operation.status !== CancellationOperationStatus.failed_retryable
    ) {
      return { completed: !operation.active };
    }
    if (!payment?.providerCheckoutSessionId) {
      await this.recordRetryableFailure(operationId, "PAYMENT_STATE_CHANGED");
      throw new ConflictException({
        code: "PAYMENT_STATE_CHANGED",
        message: "The Checkout state is not yet available for cancellation.",
        details: {}
      });
    }

    let session: Awaited<ReturnType<StripeService["expireCheckoutSession"]>>;
    try {
      session = await stripe.expireCheckoutSession({
        checkoutSessionId: payment.providerCheckoutSessionId,
        idempotencyKey: `cancellation-checkout-expiry:${operationId}`
      });
    } catch (error) {
      await this.recordRetryableFailure(
        operationId,
        this.errorCode(error) ?? "PAYMENT_PROVIDER_UNAVAILABLE"
      );
      throw error;
    }
    if (session.status !== "expired") {
      await this.recordRetryableFailure(operationId, "PAYMENT_STATE_CHANGED");
      throw new ConflictException({
        code: "PAYMENT_STATE_CHANGED",
        message: "Checkout settled before expiry could be confirmed.",
        details: {}
      });
    }

    return this.prisma.$transaction(async (transaction) => {
      const current = await this.lockAndLoadOperation(transaction, operationId);
      if (!current || !current.active) return { completed: true };
      const currentPayment = current.booking.payments[0] ?? null;
      if (
        currentPayment?.status === "paid" ||
        currentPayment?.status === "partially_refunded"
      ) {
        await this.promoteToFullRefund(transaction, current);
        return { completed: false, refundRequired: true };
      }
      if (
        !currentPayment ||
        currentPayment.id !== current.paymentId ||
        currentPayment.status !== "pending"
      ) {
        throw new ConflictException({
          code: "PAYMENT_STATE_CHANGED",
          message: "The payment state changed before expiry was finalized.",
          details: {}
        });
      }
      const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>(
        Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`
      );
      if (!clock) throw new Error("Database current time was unavailable.");
      await transaction.payment.update({
        where: { id: currentPayment.id },
        data: {
          status: "expired",
          active: false,
          failureReason: "cancellation_checkout_expired"
        }
      });
      await transaction.booking.update({
        where: { id: current.bookingId },
        data: {
          status: BookingStatus.cancelled,
          cancellationReason: this.bookingReason(current.actorType),
          cancelledAt: clock.now
        }
      });
      const completed = await transaction.bookingCancellationOperation.update({
        where: { id: current.id },
        data: {
          status: CancellationOperationStatus.completed,
          financialDisposition: CancellationFinancialDisposition.financially_complete,
          active: false,
          effectiveAt: clock.now,
          failureCode: null,
          failedAt: null
        }
      });
      await this.queueCompletionNotifications(transaction, completed, current);
      return { completed: true };
    });
  }

  async executeFullRefund(operationId: string) {
    const stripe = this.requiredStripe();
    const prepared = await this.prepareProviderOperation(operationId);
    if (!prepared) return { confirmationPending: false };
    const { operation, payment } = prepared;
    if (!operation.active) return { confirmationPending: false };
    if (
      operation.status !== CancellationOperationStatus.refund_pending &&
      operation.status !== CancellationOperationStatus.failed_retryable
    ) {
      return { confirmationPending: true };
    }
    if (
      !payment ||
      payment.id !== operation.paymentId ||
      !payment.providerPaymentIntentId ||
      (payment.status !== "paid" && payment.status !== "partially_refunded")
    ) {
      await this.recordRetryableFailure(operationId, "PAYMENT_STATE_CHANGED");
      throw new ConflictException({
        code: "PAYMENT_STATE_CHANGED",
        message: "The refundable payment state is not available.",
        details: {}
      });
    }
    const amountCents = payment.amountCents - payment.amountRefundedCents;
    if (amountCents <= 0) return { confirmationPending: true };

    let refund: Awaited<ReturnType<StripeService["createFullRefund"]>>;
    try {
      refund = await stripe.createFullRefund({
        paymentIntentId: payment.providerPaymentIntentId,
        amountCents,
        bookingId: operation.bookingId,
        paymentId: payment.id,
        cancellationOperationId: operation.id,
        idempotencyKey: `cancellation-full-refund:${operation.id}:${amountCents}`
      });
    } catch (error) {
      await this.recordRetryableFailure(
        operationId,
        this.errorCode(error) ?? "PAYMENT_PROVIDER_UNAVAILABLE"
      );
      throw error;
    }
    if (refund.status === "failed" || refund.status === "canceled") {
      await this.recordRetryableFailure(operationId, "PAYMENT_PROVIDER_UNAVAILABLE");
      throw new UnprocessableEntityException({
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
        message: "The full refund was not accepted by the payment provider.",
        details: {}
      });
    }
    await this.prisma.$transaction(async (transaction) => {
      const current = await this.lockAndLoadOperation(transaction, operationId);
      if (!current?.active) return;
      await transaction.bookingCancellationOperation.update({
        where: { id: current.id },
        data: {
          providerOperationRef: refund.id,
          failureCode: null,
          failedAt: null
        }
      });
    });
    return { confirmationPending: true };
  }

  async recoverPendingOperations(limit = 100) {
    const candidates = await this.prisma.bookingCancellationOperation.findMany({
      where: {
        active: true,
        status: {
          in: [
            CancellationOperationStatus.checkout_expiry_pending,
            CancellationOperationStatus.refund_pending,
            CancellationOperationStatus.failed_retryable
          ]
        }
      },
      select: { id: true, financialDisposition: true },
      orderBy: { updatedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500)
    });
    let completed = 0;
    let pending = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        if (
          candidate.financialDisposition ===
          CancellationFinancialDisposition.checkout_expiry_pending
        ) {
          const result = await this.executeCheckoutExpiry(candidate.id);
          if (result.completed) completed += 1;
          else pending += 1;
        } else {
          await this.executeFullRefund(candidate.id);
          pending += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { scanned: candidates.length, completed, pending, failed };
  }

  async reconcilePaymentSettled(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    paymentId: string
  ) {
    const operation = await transaction.bookingCancellationOperation.findFirst({
      where: { bookingId, active: true },
      orderBy: { version: "desc" }
    });
    if (!operation) {
      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        select: { status: true }
      });
      if (booking?.status !== BookingStatus.cancelled) return false;
      const versions = await transaction.bookingCancellationOperation.aggregate({
        where: { bookingId },
        _max: { version: true }
      });
      const recovery = await transaction.bookingCancellationOperation.create({
        data: {
          bookingId,
          paymentId,
          version: (versions._max.version ?? 0) + 1,
          actorType: CancellationActorType.system,
          actorUserId: null,
          reason: CancellationOperationReason.full_refund,
          status: CancellationOperationStatus.refund_pending,
          financialDisposition: CancellationFinancialDisposition.full_refund_pending,
          idempotencyKey: `system:late-payment-refund:${paymentId}`,
          requestedAt: new Date(),
          active: true
        }
      });
      await this.jobs.enqueue(
        BOOKING_CANCELLATION_FULL_REFUND_JOB,
        { cancellationOperationId: recovery.id },
        {
          aggregateType: "booking_cancellation",
          aggregateId: recovery.id,
          client: transaction,
          deduplicationKey: `booking-cancellation:full_refund:${recovery.id}`,
          maxAttempts: 5
        }
      );
      return true;
    }
    if (
      operation.financialDisposition !==
        CancellationFinancialDisposition.checkout_expiry_pending &&
      operation.status !== CancellationOperationStatus.checkout_expiry_pending &&
      operation.status !== CancellationOperationStatus.failed_retryable
    ) {
      return operation.financialDisposition ===
        CancellationFinancialDisposition.full_refund_pending;
    }
    await transaction.bookingCancellationOperation.update({
      where: { id: operation.id },
      data: {
        paymentId,
        status: CancellationOperationStatus.refund_pending,
        financialDisposition: CancellationFinancialDisposition.full_refund_pending,
        failureCode: null,
        failedAt: null
      }
    });
    await this.jobs.enqueue(
      BOOKING_CANCELLATION_FULL_REFUND_JOB,
      { cancellationOperationId: operation.id },
      {
        aggregateType: "booking_cancellation",
        aggregateId: operation.id,
        client: transaction,
        deduplicationKey: `booking-cancellation:full_refund:${operation.id}`,
        maxAttempts: 5
      }
    );
    return true;
  }

  async reconcileCancellationEffective(
    transaction: Prisma.TransactionClient,
    input: {
      bookingId: string;
      paymentId: string;
      reason: "full_refund" | "payment_disputed" | "payment_expired" | "payment_failed";
      effectiveAt: Date;
    }
  ) {
    let operation = await transaction.bookingCancellationOperation.findFirst({
      where: { bookingId: input.bookingId, active: true },
      orderBy: { version: "desc" }
    });
    const transfer = await transaction.hostTransfer.findUnique({
      where: { bookingId: input.bookingId }
    });
    const reversalPending =
      input.reason === "full_refund" &&
      transfer?.providerTransferId != null &&
      transfer.reversalTargetAmountCents > transfer.reversedAmountCents;
    const state = reversalPending
      ? {
          status: CancellationOperationStatus.transfer_reversal_pending,
          financialDisposition:
            CancellationFinancialDisposition.transfer_reversal_pending,
          active: true
        }
      : {
          status: CancellationOperationStatus.completed,
          financialDisposition: CancellationFinancialDisposition.financially_complete,
          active: false
        };

    if (operation) {
      operation = await transaction.bookingCancellationOperation.update({
        where: { id: operation.id },
        data: {
          paymentId: input.paymentId,
          ...state,
          effectiveAt: input.effectiveAt,
          failureCode: null,
          failedAt: null
        }
      });
    } else {
      const versions = await transaction.bookingCancellationOperation.aggregate({
        where: { bookingId: input.bookingId },
        _max: { version: true }
      });
      operation = await transaction.bookingCancellationOperation.create({
        data: {
          bookingId: input.bookingId,
          paymentId: input.paymentId,
          version: (versions._max.version ?? 0) + 1,
          actorType: CancellationActorType.system,
          actorUserId: null,
          reason: CancellationOperationReason[input.reason],
          ...state,
          idempotencyKey: `system:${input.reason}:${input.paymentId}`,
          requestedAt: input.effectiveAt,
          effectiveAt: input.effectiveAt
        }
      });
    }
    const booking = await transaction.booking.findUnique({
      where: { id: input.bookingId },
      select: { renterId: true, hostId: true }
    });
    if (booking) {
      await this.queueParticipantNotifications(
        transaction,
        operation,
        operation.actorType,
        booking.renterId,
        booking.hostId,
        input.reason === "full_refund"
          ? "booking_cancelled_refunded"
          : input.reason === "payment_disputed"
          ? "booking_cancelled_financial_event"
          : "booking_cancelled_no_payment"
      );
    }
    return { operation, reversalPending };
  }

  async reconcileTransferReversal(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    effectiveAt: Date
  ) {
    const transfer = await transaction.hostTransfer.findUnique({
      where: { bookingId }
    });
    if (
      !transfer ||
      transfer.reversalTargetAmountCents <= 0 ||
      transfer.reversedAmountCents < transfer.reversalTargetAmountCents
    ) {
      return false;
    }
    const operation = await transaction.bookingCancellationOperation.findFirst({
      where: {
        bookingId,
        active: true,
        status: CancellationOperationStatus.transfer_reversal_pending
      },
      orderBy: { version: "desc" }
    });
    if (!operation) return false;
    await transaction.bookingCancellationOperation.update({
      where: { id: operation.id },
      data: {
        status: CancellationOperationStatus.completed,
        financialDisposition: CancellationFinancialDisposition.financially_complete,
        active: false,
        effectiveAt: operation.effectiveAt ?? effectiveAt,
        failureCode: null,
        failedAt: null
      }
    });
    return true;
  }

  private async prepareProviderOperation(operationId: string) {
    const candidate = await this.prisma.bookingCancellationOperation.findUnique({
      where: { id: operationId },
      select: { bookingId: true, booking: { select: { listingId: true } } }
    });
    if (!candidate) return null;
    return this.prisma.$transaction(async (transaction) => {
      const operation = await this.lockAndLoadOperation(transaction, operationId);
      if (!operation) return null;
      return { operation, payment: operation.booking.payments[0] ?? null };
    });
  }

  private async lockAndLoadOperation(
    transaction: Prisma.TransactionClient,
    operationId: string
  ) {
    const first = await transaction.bookingCancellationOperation.findUnique({
      where: { id: operationId },
      include: {
        booking: {
          include: {
            payments: { orderBy: { attemptNumber: "desc" }, take: 1 },
            hostTransfer: true
          }
        }
      }
    });
    if (!first) return null;
    await this.lock(transaction, first.booking.listingId);
    await this.lock(transaction, `booking:${first.bookingId}`);
    await this.lock(transaction, `checkout:${first.bookingId}`);
    const payment = first.booking.payments[0];
    if (payment) await this.lock(transaction, `payment:${payment.id}`);
    if (first.booking.hostTransfer) {
      await this.lock(
        transaction,
        `host-transfer:${first.booking.hostTransfer.id}`
      );
    }
    return transaction.bookingCancellationOperation.findUnique({
      where: { id: operationId },
      include: {
        booking: {
          include: {
            payments: { orderBy: { attemptNumber: "desc" }, take: 1 },
            hostTransfer: true
          }
        }
      }
    });
  }

  private async promoteToFullRefund(
    transaction: Prisma.TransactionClient,
    operation: Awaited<ReturnType<BookingCancellationsService["lockAndLoadOperation"]>> & {}
  ) {
    if (!operation) return;
    await transaction.bookingCancellationOperation.update({
      where: { id: operation.id },
      data: {
        status: CancellationOperationStatus.refund_pending,
        financialDisposition: CancellationFinancialDisposition.full_refund_pending,
        paymentId: operation.booking.payments[0]?.id ?? operation.paymentId,
        failureCode: null,
        failedAt: null
      }
    });
    await this.jobs.enqueue(
      BOOKING_CANCELLATION_FULL_REFUND_JOB,
      { cancellationOperationId: operation.id },
      {
        aggregateType: "booking_cancellation",
        aggregateId: operation.id,
        client: transaction,
        deduplicationKey: `booking-cancellation:full_refund:${operation.id}`,
        maxAttempts: 5
      }
    );
  }

  private async recordRetryableFailure(operationId: string, failureCode: string) {
    await this.prisma.$transaction(async (transaction) => {
      const operation = await this.lockAndLoadOperation(transaction, operationId);
      if (!operation?.active) return;
      await transaction.bookingCancellationOperation.update({
        where: { id: operation.id },
        data: {
          status: CancellationOperationStatus.failed_retryable,
          failureCode: failureCode.slice(0, 100),
          failedAt: new Date()
        }
      });
    });
  }

  private queueCompletionNotifications(
    transaction: Prisma.TransactionClient,
    operation: BookingCancellationOperation,
    context: { actorType: CancellationActorType; booking: { renterId: string; hostId: string } }
  ) {
    return this.queueParticipantNotifications(
      transaction,
      operation,
      context.actorType as CancellationRequestActor,
      context.booking.renterId,
      context.booking.hostId,
      "booking_cancelled_no_payment"
    );
  }

  private bookingReason(actorType: CancellationActorType) {
    if (actorType === CancellationActorType.renter) return "renter_cancelled" as const;
    if (actorType === CancellationActorType.host) return "host_cancelled" as const;
    return "admin_cancelled" as const;
  }

  private requiredStripe() {
    if (!this.stripe) throw new Error("Stripe cancellation provider is unavailable.");
    return this.stripe;
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
        return typeof response.code === "string" ? response.code : null;
      }
    }
    return null;
  }

  private loadBooking(transaction: Prisma.TransactionClient, bookingId: string) {
    return transaction.booking.findUnique({
      where: { id: bookingId },
      include: {
        payments: { orderBy: { attemptNumber: "desc" }, take: 1 },
        hostTransfer: true
      }
    });
  }

  private actorFor(
    user: Pick<User, "id" | "roles">,
    booking: { renterId: string; hostId: string }
  ): CancellationRequestActor {
    if (user.roles.includes(UserRole.admin)) return "admin";
    if (booking.renterId === user.id && user.roles.includes(UserRole.renter)) {
      return "renter";
    }
    if (booking.hostId === user.id && user.roles.includes(UserRole.host)) {
      return "host";
    }
    throw this.notFound();
  }

  private assertReasonAllowed(actor: CancellationRequestActor, reason: string) {
    if (!allowedReasons[actor].has(reason)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "The cancellation reason is not allowed for this actor.",
        details: {}
      });
    }
  }

  private plan(input: Parameters<typeof decideCancellationPlan>[0]) {
    try {
      return decideCancellationPlan(input);
    } catch (error) {
      if (!(error instanceof CancellationPolicyError)) throw error;
      const body = { code: error.code, message: this.policyMessage(error.code), details: {} };
      if (error.code === "PAYMENT_STATE_CHANGED") {
        throw new ConflictException(body);
      }
      if (error.code === "PAID_CANCELLATION_POLICY_UNAVAILABLE") {
        throw new UnprocessableEntityException(body);
      }
      throw new BadRequestException(body);
    }
  }

  private operationState(
    kind: "immediate" | "checkout_expiry" | "full_refund",
    now: Date
  ) {
    if (kind === "immediate") {
      return {
        status: CancellationOperationStatus.completed,
        financialDisposition: CancellationFinancialDisposition.no_payment_collected,
        active: false,
        effectiveAt: now
      };
    }
    if (kind === "checkout_expiry") {
      return {
        status: CancellationOperationStatus.checkout_expiry_pending,
        financialDisposition: CancellationFinancialDisposition.checkout_expiry_pending,
        active: true,
        effectiveAt: null
      };
    }
    return {
      status: CancellationOperationStatus.refund_pending,
      financialDisposition: CancellationFinancialDisposition.full_refund_pending,
      active: true,
      effectiveAt: null
    };
  }

  private async queueParticipantNotifications(
    transaction: Prisma.TransactionClient,
    operation: BookingCancellationOperation,
    actorType: CancellationRequestActor | CancellationActorType,
    renterId: string,
    hostId: string,
    template: BookingCancellationEmailPayload["template"]
  ) {
    const recipients = actorType === "admin" || actorType === "system"
      ? [renterId, hostId]
      : [actorType === "renter" ? hostId : renterId];
    for (const recipientUserId of recipients) {
      const payload: BookingCancellationEmailPayload = {
        cancellationOperationId: operation.id,
        recipientUserId,
        template
      };
      await this.jobs.enqueue(BOOKING_CANCELLATION_EMAIL_JOB, payload, {
        aggregateType: "booking_cancellation",
        aggregateId: operation.id,
        client: transaction,
        deduplicationKey: `booking-cancellation-email:${operation.id}:${recipientUserId}:${template}`
      });
    }
  }

  private toResult(bookingStatus: BookingStatus, operation: BookingCancellationOperation) {
    return {
      bookingId: operation.bookingId,
      bookingStatus,
      cancellation: {
        id: operation.id,
        actorType: operation.actorType,
        reason: operation.reason,
        status: operation.status,
        financialDisposition: operation.financialDisposition,
        requestedAt: operation.requestedAt.toISOString(),
        effectiveAt: operation.effectiveAt?.toISOString() ?? null
      }
    };
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private policyMessage(code: CancellationPolicyError["code"]) {
    if (code === "PAID_CANCELLATION_POLICY_UNAVAILABLE") {
      return "Paid Renter self-service cancellation is not available.";
    }
    if (code === "PAYMENT_STATE_CHANGED") {
      return "The payment state changed before cancellation could be established.";
    }
    return "This booking cannot be cancelled in its current state.";
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Booking was not found.",
      details: {}
    });
  }
}
