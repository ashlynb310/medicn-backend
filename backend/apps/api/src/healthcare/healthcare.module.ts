import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { MediaModule } from "../media/media.module";
import { HealthcareVerificationController } from "./healthcare-verification.controller";
import { HealthcareVerificationService } from "./healthcare-verification.service";
import { HealthcareAdminController } from "./healthcare-admin.controller";
import { HealthcareAdminService } from "./healthcare-admin.service";
import { HealthcareEvidenceDeletionService } from "./healthcare-evidence-deletion.service";

@Module({
  imports: [AuthModule, IdentityModule, JobsModule, MediaModule],
  controllers: [HealthcareVerificationController, HealthcareAdminController],
  providers: [
    HealthcareVerificationService,
    HealthcareAdminService,
    HealthcareEvidenceDeletionService
  ],
  exports: [HealthcareVerificationService, HealthcareEvidenceDeletionService]
})
export class HealthcareModule {}
