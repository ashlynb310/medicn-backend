export const MAPS_PROVIDER = Symbol("MAPS_PROVIDER");
export const ENRICH_LISTING_LOCATION_JOB = "maps.enrich-listing-location";
export const MAPS_QUEUE_NAME = "maps";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type GeocodePrecision =
  | "rooftop"
  | "range_interpolated"
  | "geometric_center"
  | "approximate"
  | "unknown";

export type GeocodeResult =
  | {
      status: "verified";
      latitude: number;
      longitude: number;
      formattedAddress: string;
      placeId: string;
      precision: GeocodePrecision;
    }
  | { status: "ambiguous" }
  | { status: "not_found" };

export interface NearbySearchInput {
  center: Coordinates;
  includedTypes: string[];
  radiusMeters: number;
  maxResults: number;
}

export interface ProviderNearbyPlace {
  placeId: string;
  name: string;
  mapsUrl: string;
  location: Coordinates;
  types: string[];
}

export type TravelMode = "walking" | "driving";

export interface RouteMatrixInput {
  origin: Coordinates;
  destinations: Coordinates[];
  travelMode: TravelMode;
}

export interface RouteMatrixResult {
  destinationIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export type MapsProviderFailure =
  | "disabled"
  | "timeout"
  | "unavailable"
  | "invalid_request"
  | "quota";

export class MapsProviderError extends Error {
  constructor(
    readonly category: MapsProviderFailure,
    message: string
  ) {
    super(message);
    this.name = "MapsProviderError";
  }
}

export interface MapsProvider {
  geocodeAddress(
    input: { address: string; placeId?: string },
    signal?: AbortSignal
  ): Promise<GeocodeResult>;
  searchNearby(
    input: NearbySearchInput,
    signal?: AbortSignal
  ): Promise<ProviderNearbyPlace[]>;
  computeRouteMatrix(
    input: RouteMatrixInput,
    signal?: AbortSignal
  ): Promise<RouteMatrixResult[]>;
}
