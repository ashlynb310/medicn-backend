import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { validateEnv } from "./config/env.validation";
import { HealthModule } from "./health/health.module";
import { ListingsModule } from "./listings/listings.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UploadsModule } from "./uploads/uploads.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validate: validateEnv
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ListingsModule,
    UploadsModule,
    HealthModule
  ]
})
export class AppModule {}
