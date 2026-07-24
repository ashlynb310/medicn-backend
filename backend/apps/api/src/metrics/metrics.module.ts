import { Module } from "@nestjs/common";
import { OperationsModule } from "../operations/operations.module";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Module({ imports: [OperationsModule], controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
