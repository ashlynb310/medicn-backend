import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { PaymentsController } from "./payments.controller";
import { PaymentTransitionService } from "./payment-transition.service";
import { PaymentsService } from "./payments.service";
import { StripeService } from "./stripe.service";
import { ConnectController } from "./connect.controller";
import { ConnectService } from "./connect.service";
import { HostTransfersService } from "./host-transfers.service";
import { BookingCancellationsService } from "./booking-cancellations.service";
import { BookingLifecycleService } from "./booking-lifecycle.service";
import { PaymentOperationsService } from "./payment-operations.service";
import { FinancialReconciliationService } from "./financial-reconciliation.service";

@Module({
  imports: [AuthModule, EmailModule, IdentityModule, JobsModule],
  controllers: [PaymentsController, ConnectController],
  providers: [
    PaymentsService,
    StripeService,
    PaymentTransitionService,
    ConnectService,
    HostTransfersService,
    BookingCancellationsService,
    BookingLifecycleService,
    PaymentOperationsService,
    FinancialReconciliationService
  ],
  exports: [
    PaymentsService,
    PaymentTransitionService,
    ConnectService,
    HostTransfersService,
    BookingCancellationsService,
    BookingLifecycleService,
    PaymentOperationsService,
    FinancialReconciliationService
  ]
})
export class PaymentsModule {}
