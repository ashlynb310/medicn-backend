import { Injectable, Optional } from "@nestjs/common";
import { EmailWebhookService } from "../email/email-webhook.service";
import { IdentityService } from "../identity/identity.service";
import { JobExecutionService } from "../jobs/job-execution.service";
import { JobsService } from "../jobs/jobs.service";
import { LocationService } from "../maps/location.service";
import { MediaProcessingService } from "../media/media-processing.service";
import { HostTransfersService } from "../payments/host-transfers.service";
import { PaymentsService } from "../payments/payments.service";
import { OPERATION_JOB_NAMES, type OperationJobName } from "./operations.types";
import { BookingCancellationsService } from "../payments/booking-cancellations.service";
import type { BookingCancellationOperationPayload } from "../bookings/booking-cancellation.types";
import { BookingLifecycleService } from "../payments/booking-lifecycle.service";
import { OperationalCommandsService } from "./operational-commands.service";
import type { ExecuteOperationalCommandPayload } from "./operational-command.types";

@Injectable()
export class OperationsService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly transfers: HostTransfersService,
    private readonly identity: IdentityService,
    private readonly media: MediaProcessingService,
    private readonly locations: LocationService,
    private readonly emailWebhooks: EmailWebhookService,
    private readonly jobs: JobsService,
    private readonly executions: JobExecutionService,
    private readonly operationalCommands: OperationalCommandsService,
    @Optional() private readonly cancellations?: BookingCancellationsService,
    @Optional() private readonly bookingLifecycle?: BookingLifecycleService
  ) {}

  async run(name: OperationJobName, payload?: unknown) {
    switch (name) {
      case OPERATION_JOB_NAMES.stripeWebhookRetry:
        return this.payments.retryFailedWebhookEvents(50);
      case OPERATION_JOB_NAMES.checkoutExpiry:
        return this.payments.expireStaleCheckoutAttempts(100);
      case OPERATION_JOB_NAMES.hostTransferRelease:
        return this.transfers.releaseEligibleHostTransfers(100);
      case OPERATION_JOB_NAMES.veriffWebhookRetry:
        return this.identity.retryFailedWebhookEvents(50);
      case OPERATION_JOB_NAMES.mediaRecovery:
        return this.media.recover(100);
      case OPERATION_JOB_NAMES.mediaCleanup:
        return this.media.cleanupDue(100);
      case OPERATION_JOB_NAMES.mapsRecovery:
        return this.locations.retryFailed(100);
      case OPERATION_JOB_NAMES.mapsRefresh:
        return this.locations.queueExpiredForRefresh(100);
      case OPERATION_JOB_NAMES.brevoWebhookRetry:
        return this.emailWebhooks.retryFailed(100);
      case OPERATION_JOB_NAMES.staleRecovery:
        return this.recoverStale();
      case OPERATION_JOB_NAMES.bookingCancellationCheckoutExpiry:
        return this.requiredCancellations().executeCheckoutExpiry(
          this.cancellationOperationId(payload)
        );
      case OPERATION_JOB_NAMES.bookingCancellationFullRefund:
        return this.requiredCancellations().executeFullRefund(
          this.cancellationOperationId(payload)
        );
      case OPERATION_JOB_NAMES.bookingCancellationRecovery:
        return this.requiredCancellations().recoverPendingOperations(100);
      case OPERATION_JOB_NAMES.requestedBookingExpiry:
        return this.requiredBookingLifecycle().expireRequestedBookings(100);
      case OPERATION_JOB_NAMES.bookingCompletion:
        return this.requiredBookingLifecycle().completeEligibleBookings(100);
      case OPERATION_JOB_NAMES.executeOperationalCommand:
        return this.operationalCommands.execute(
          this.operationalCommandId(payload)
        );
    }
  }

  async recoverStale() {
    const now = new Date();
    const [outbox, executions] = await Promise.all([
      this.jobs.recoverExpiredClaims(now),
      this.executions.recoverStale(new Date(now.getTime() - 15 * 60_000))
    ]);
    return { outbox: outbox.count, executions: executions.count };
  }

  private cancellationOperationId(payload: unknown) {
    const value = payload as Partial<BookingCancellationOperationPayload> | undefined;
    if (!value || typeof value.cancellationOperationId !== "string") {
      throw new Error("Invalid booking cancellation job payload.");
    }
    return value.cancellationOperationId;
  }

  private requiredCancellations() {
    if (!this.cancellations) {
      throw new Error("Booking cancellation operations are unavailable.");
    }
    return this.cancellations;
  }

  private operationalCommandId(payload: unknown) {
    const value = payload as Partial<ExecuteOperationalCommandPayload> | undefined;
    if (!value || typeof value.operationalCommandId !== "string") {
      throw new Error("Invalid operational command job payload.");
    }
    return value.operationalCommandId;
  }

  private requiredBookingLifecycle() {
    if (!this.bookingLifecycle) {
      throw new Error("Booking lifecycle operations are unavailable.");
    }
    return this.bookingLifecycle;
  }
}
