import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IdentityModule } from "../identity/identity.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminOperationsController } from "./admin-operations.controller";
import { AdminOperationsService } from "./admin-operations.service";
import { OperationsModule } from "../operations/operations.module";

@Module({
  imports: [AuthModule, IdentityModule, OperationsModule],
  controllers: [AdminController, AdminOperationsController],
  providers: [AdminService, AdminOperationsService]
})
export class AdminModule {}
