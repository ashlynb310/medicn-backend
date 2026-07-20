import { ConfigService } from "@nestjs/config";
import { isValidCoordinates } from "./geo";
import {
  MapsProviderError,
  type GeocodePrecision,
  type GeocodeResult,
  type MapsProvider,
  type NearbySearchInput,
  type ProviderNearbyPlace,
  type RouteMatrixInput,
  type RouteMatrixResult
} from "./maps.types";

const GEOCODE_ADDRESS_MASK =
  "results.placeId,results.formattedAddress,results.location,results.granularity,results.types";
const GEOCODE_PLACE_MASK =
  "placeId,formattedAddress,location,granularity,types";
const NEARBY_MASK =
  "places.id,places.displayName,places.googleMapsUri,places.location,places.types";
const ROUTE_MASK =
  "originIndex,destinationIndex,status,condition,distanceMeters,duration";
const MAX_RESPONSE_BYTES = 1_048_576;

export class GoogleMapsProvider implements MapsProvider {
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("GOOGLE_MAPS_SERVER_API_KEY") ?? "";
    this.timeoutMs = config.get<number>("MAPS_PROVIDER_TIMEOUT_MS") ?? 5000;
  }

  async geocodeAddress(
    input: { address: string; placeId?: string },
    signal?: AbortSignal
  ): Promise<GeocodeResult> {
    const isPlace = Boolean(input.placeId);
    const value = isPlace ? input.placeId! : input.address;
    const url = `https://geocode.googleapis.com/v4/geocode/${
      isPlace ? "places" : "address"
    }/${encodeURIComponent(value)}`;
    const body = await this.requestJson(url, {
      method: "GET",
      headers: this.headers(isPlace ? GEOCODE_PLACE_MASK : GEOCODE_ADDRESS_MASK)
    }, signal);
    const candidates = isPlace ? [body] : this.arrayProperty(body, "results");
    if (candidates.length === 0) return { status: "not_found" };
    if (candidates.length !== 1) return { status: "ambiguous" };
    return this.parseGeocodeCandidate(candidates[0]);
  }

  async searchNearby(input: NearbySearchInput, signal?: AbortSignal) {
    const body = await this.requestJson(
      "https://places.googleapis.com/v1/places:searchNearby",
      {
        method: "POST",
        headers: this.headers(NEARBY_MASK),
        body: JSON.stringify({
          includedTypes: input.includedTypes,
          maxResultCount: input.maxResults,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: { center: input.center, radius: input.radiusMeters }
          }
        })
      },
      signal
    );
    return this.arrayProperty(body, "places")
      .map((place) => this.parseNearbyPlace(place))
      .filter((place): place is ProviderNearbyPlace => place !== null)
      .slice(0, input.maxResults);
  }

  async computeRouteMatrix(input: RouteMatrixInput, signal?: AbortSignal) {
    const body = await this.requestJson(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        headers: this.headers(ROUTE_MASK),
        body: JSON.stringify({
          origins: [{ waypoint: { location: { latLng: input.origin } } }],
          destinations: input.destinations.map((destination) => ({
            waypoint: { location: { latLng: destination } }
          })),
          travelMode: input.travelMode === "walking" ? "WALK" : "DRIVE"
        })
      },
      signal
    );
    if (!Array.isArray(body)) throw this.unavailable();
    const byDestination = new Map<number, RouteMatrixResult>();
    for (const entry of body) {
      const record = this.record(entry);
      const index = this.integer(record?.destinationIndex);
      if (index === null || index < 0 || index >= input.destinations.length) continue;
      const routeExists = record?.condition === "ROUTE_EXISTS" &&
        this.statusCode(record.status) === 0;
      byDestination.set(index, {
        destinationIndex: index,
        distanceMeters: routeExists ? this.nonNegativeInteger(record.distanceMeters) : null,
        durationSeconds: routeExists ? this.durationSeconds(record.duration) : null
      });
    }
    return input.destinations.map((_, destinationIndex) =>
      byDestination.get(destinationIndex) ?? {
        destinationIndex,
        distanceMeters: null,
        durationSeconds: null
      }
    );
  }

  private parseGeocodeCandidate(value: unknown): GeocodeResult {
    const candidate = this.record(value);
    const location = this.record(candidate?.location);
    const coordinates = {
      latitude: this.number(location?.latitude),
      longitude: this.number(location?.longitude)
    };
    const placeId = this.string(candidate?.placeId);
    const formattedAddress = this.string(candidate?.formattedAddress);
    const precision = this.precision(candidate?.granularity);
    const types = this.stringArray(candidate?.types);
    if (
      coordinates.latitude === null || coordinates.longitude === null ||
      !isValidCoordinates({ latitude: coordinates.latitude, longitude: coordinates.longitude }) ||
      !placeId || !formattedAddress
    ) return { status: "not_found" };
    const preciseType = types.some((type) =>
      type === "street_address" || type === "premise" || type === "subpremise"
    );
    if (!preciseType || precision === "approximate" || precision === "unknown") {
      return { status: "ambiguous" };
    }
    return {
      status: "verified",
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      formattedAddress,
      placeId,
      precision
    };
  }

  private parseNearbyPlace(value: unknown): ProviderNearbyPlace | null {
    const place = this.record(value);
    const displayName = this.record(place?.displayName);
    const location = this.record(place?.location);
    const candidate = {
      placeId: this.string(place?.id),
      name: this.string(displayName?.text),
      mapsUrl: this.safeMapsUrl(this.string(place?.googleMapsUri)),
      latitude: this.number(location?.latitude),
      longitude: this.number(location?.longitude),
      types: this.stringArray(place?.types)
    };
    if (!candidate.placeId || !candidate.name || !candidate.mapsUrl ||
      candidate.latitude === null || candidate.longitude === null ||
      !isValidCoordinates({ latitude: candidate.latitude, longitude: candidate.longitude })) {
      return null;
    }
    return {
      placeId: candidate.placeId,
      name: candidate.name.slice(0, 200),
      mapsUrl: candidate.mapsUrl,
      location: { latitude: candidate.latitude, longitude: candidate.longitude },
      types: candidate.types.slice(0, 20)
    };
  }

  private async requestJson(url: string, init: RequestInit, signal?: AbortSignal) {
    if (!this.apiKey) throw new MapsProviderError("disabled", "Maps is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw this.httpError(response.status);
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw this.unavailable();
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof MapsProviderError) throw error;
      if (controller.signal.aborted) {
        throw new MapsProviderError("timeout", "Maps provider timed out.");
      }
      throw this.unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private headers(fieldMask: string) {
    return {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": this.apiKey,
      "X-Goog-FieldMask": fieldMask
    };
  }
  private httpError(status: number) {
    if (status === 400) return new MapsProviderError("invalid_request", "Maps request was invalid.");
    if (status === 429) return new MapsProviderError("quota", "Maps provider quota was exceeded.");
    return this.unavailable();
  }
  private unavailable() { return new MapsProviderError("unavailable", "Maps provider is unavailable."); }
  private record(value: unknown) { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  private arrayProperty(value: unknown, key: string) { const record = this.record(value); return Array.isArray(record?.[key]) ? record[key] as unknown[] : []; }
  private string(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
  private stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
  private number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
  private integer(value: unknown) { return typeof value === "number" && Number.isInteger(value) ? value : null; }
  private nonNegativeInteger(value: unknown) { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null; }
  private statusCode(value: unknown) { const status = this.record(value); return status && Object.keys(status).length > 0 ? this.integer(status.code) ?? 1 : 0; }
  private durationSeconds(value: unknown) { const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null; return match ? Math.round(Number(match[1])) : null; }
  private precision(value: unknown): GeocodePrecision {
    if (value === "ROOFTOP") return "rooftop";
    if (value === "RANGE_INTERPOLATED") return "range_interpolated";
    if (value === "GEOMETRIC_CENTER") return "geometric_center";
    if (value === "APPROXIMATE") return "approximate";
    return "unknown";
  }
  private safeMapsUrl(value: string | null) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && ["google.com", "www.google.com", "maps.google.com"].includes(url.hostname)
        ? url.toString()
        : null;
    } catch { return null; }
  }
}
