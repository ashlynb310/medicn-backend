import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { MapsModule } from "../maps/maps.module";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";
import { ListingAvailabilityService } from "./listing-availability.service";

@Module({
  imports: [AuthModule, MapsModule, JobsModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingAvailabilityService],
  exports: [ListingsService, ListingAvailabilityService]
})
export class ListingsModule {}
