import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { IdentityController } from "./identity.controller";
import { IdentityEligibilityService } from "./identity-eligibility.service";
import { IdentityService } from "./identity.service";
import { VeriffIdentityProvider } from "./veriff.provider";

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    IdentityEligibilityService,
    VeriffIdentityProvider
  ],
  exports: [IdentityService, IdentityEligibilityService]
})
export class IdentityModule {}
