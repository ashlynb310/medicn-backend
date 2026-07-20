import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  MAPS_PROVIDER,
  MapsProviderError,
  type GeocodeResult,
  type MapsProvider,
  type NearbySearchInput,
  type RouteMatrixInput
} from "./maps.types";

export interface ResolvedPlace {
  label: string;
  googlePlaceId: string | null;
  mapsUrl: string;
}

@Injectable()
export class MapsService {
  constructor(
    private readonly config: ConfigService,
    @Inject(MAPS_PROVIDER) private readonly provider: MapsProvider
  ) {}

  isEnabled() {
    return this.config.get<boolean>("MAPS_ENABLED") === true;
  }

  async geocodeAddress(address: string, placeId?: string): Promise<GeocodeResult> {
    if (!this.isEnabled()) {
      throw new MapsProviderError("disabled", "Maps is disabled.");
    }
    return this.provider.geocodeAddress({ address, placeId });
  }

  async searchNearby(input: NearbySearchInput) {
    if (!this.isEnabled()) {
      throw new MapsProviderError("disabled", "Maps is disabled.");
    }
    return this.provider.searchNearby(input);
  }

  async computeRouteMatrix(input: RouteMatrixInput) {
    if (!this.isEnabled()) {
      throw new MapsProviderError("disabled", "Maps is disabled.");
    }
    return this.provider.computeRouteMatrix(input);
  }

  // Curated host-entered labels remain provider-free. Automated nearby enrichment
  // uses Places API (New) through searchNearby instead.
  async resolvePlace(label: string, city?: string): Promise<ResolvedPlace> {
    const normalizedLabel = label.trim();
    return {
      label: normalizedLabel,
      googlePlaceId: null,
      mapsUrl: this.toGoogleMapsSearchUrl(normalizedLabel, city)
    };
  }

  toGoogleMapsSearchUrl(label: string, city?: string) {
    const query = city ? `${label}, ${city}` : label;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }
}
