import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleMapsProvider } from "./google-maps.provider";
import { LocationService } from "./location.service";
import { MapsService } from "./maps.service";
import { MAPS_PROVIDER } from "./maps.types";

@Module({
  providers: [
    {
      provide: MAPS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new GoogleMapsProvider(config)
    },
    MapsService,
    LocationService
  ],
  exports: [MapsService, LocationService]
})
export class MapsModule {}
