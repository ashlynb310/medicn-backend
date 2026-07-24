import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { BookingsModule } from "./bookings/bookings.module";
import { validateEnv } from "./config/env.validation";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { ListingsModule } from "./listings/listings.module";
import { PaymentsModule } from "./payments/payments.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UploadsModule } from "./uploads/uploads.module";
import { UsersModule } from "./users/users.module";
import { OperationsModule } from "./operations/operations.module";
import { MetricsModule } from "./metrics/metrics.module";
import { MessagingModule } from "./messaging/messaging.module";
import { HealthcareModule } from "./healthcare/healthcare.module";
import { APP_GUARD } from "@nestjs/core";
import { BearerAuthGuard } from "./common/http/bearer-auth.guard";
import { HttpSecurityModule } from "./common/http/http-security.module";
import { RateLimitGuard } from "./common/http/rate-limit.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validate: validateEnv
    }),
    HttpSecurityModule,
    PrismaModule,
    AuthModule,
    AdminModule,
    UsersModule,
    ListingsModule,
    UploadsModule,
    BookingsModule,
    PaymentsModule,
    IdentityModule,
    HealthcareModule,
    MessagingModule,
    OperationsModule,
    MetricsModule,
    HealthModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: BearerAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard }
  ]
})
export class AppModule {}
