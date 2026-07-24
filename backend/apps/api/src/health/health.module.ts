import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { OperationsModule } from "../operations/operations.module";
import { HealthService } from "./health.service";

@Module({
  imports: [OperationsModule],
  controllers: [HealthController],
  providers: [HealthService]
})
export class HealthModule {}
