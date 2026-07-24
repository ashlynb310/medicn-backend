import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  LocationEnrichmentStatus,
  LocationGeocodeStatus,
  LocationPrecision,
  MapsTravelMode,
  NearbyPlaceCategory,
  Prisma
} from "@prisma/client";
import { addressFingerprint, haversineDistanceMeters, normalizeAddress, stableApproximateCoordinates } from "./geo";
import { MapsService } from "./maps.service";
import { MapsProviderError, type GeocodePrecision, type ProviderNearbyPlace, type TravelMode } from "./maps.types";
import { PrismaService } from "../prisma/prisma.service";

const CATEGORY_TYPES: Record<NearbyPlaceCategory, string[]> = {
  [NearbyPlaceCategory.medical]: ["hospital", "general_hospital", "medical_center"],
  [NearbyPlaceCategory.pharmacy]: ["pharmacy"],
  [NearbyPlaceCategory.transit]: ["transit_station"],
  [NearbyPlaceCategory.grocery]: ["grocery_store", "supermarket"]
};

export type LocationVerification =
  | {
      status: "verified";
      normalizedAddress: string;
      fingerprint: string;
      formattedAddress: string;
      providerPlaceId: string;
      latitude: number;
      longitude: number;
      precision: LocationPrecision;
    }
  | {
      status: "ambiguous" | "failed";
      normalizedAddress: string;
      fingerprint: string;
      failureCategory: string;
    };

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: MapsService,
    private readonly config: ConfigService
  ) {}

  async verifyInput(address: string, city: string, placeId?: string): Promise<LocationVerification> {
    const normalizedAddress = normalizeAddress(`${address}, ${city}`);
    this.assertAddress(normalizedAddress);
    const fingerprint = addressFingerprint(normalizedAddress);
    try {
      const result = await this.maps.geocodeAddress(normalizedAddress, placeId);
      if (result.status !== "verified") {
        return {
          status: "ambiguous",
          normalizedAddress,
          fingerprint,
          failureCategory: result.status
        };
      }
      return {
        status: "verified",
        normalizedAddress,
        fingerprint,
        formattedAddress: result.formattedAddress,
        providerPlaceId: result.placeId,
        latitude: result.latitude,
        longitude: result.longitude,
        precision: this.toPrecision(result.precision)
      };
    } catch (error) {
      return {
        status: "failed",
        normalizedAddress,
        fingerprint,
        failureCategory: error instanceof MapsProviderError ? error.category : "unavailable"
      };
    }
  }

  async enrichListing(listingId: string, addressVersion?: number) {
    const staleProcessingBefore = new Date(Date.now() - 15 * 60_000);
    const location = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`maps-listing:${listingId}`}, 0))`
      );
      const candidate = await transaction.listingLocation.findUnique({
        where: { listingId },
        include: { listing: { select: { publicLatitude: true, publicLongitude: true } } }
      });
      if (!candidate || candidate.geocodeStatus !== LocationGeocodeStatus.verified ||
        candidate.verifiedAddressVersion !== candidate.addressVersion ||
        (addressVersion !== undefined && addressVersion !== candidate.addressVersion) ||
        candidate.listing.publicLatitude === null || candidate.listing.publicLongitude === null) {
        return null;
      }
      const claimed = await transaction.listingLocation.updateMany({
        where: {
          id: candidate.id,
          addressVersion: candidate.addressVersion,
          geocodeStatus: LocationGeocodeStatus.verified,
          OR: [
            { enrichmentStatus: { in: [
              LocationEnrichmentStatus.not_started,
              LocationEnrichmentStatus.pending,
              LocationEnrichmentStatus.failed,
              LocationEnrichmentStatus.stale
            ] } },
            {
              enrichmentStatus: LocationEnrichmentStatus.processing,
              processingStartedAt: { lte: staleProcessingBefore }
            }
          ]
        },
        data: { enrichmentStatus: LocationEnrichmentStatus.processing, processingStartedAt: new Date() }
      });
      return claimed.count === 1 ? candidate : null;
    });
    if (!location) return { status: "skipped" as const };

    const origin = {
      latitude: Number(location.listing.publicLatitude),
      longitude: Number(location.listing.publicLongitude)
    };
    const radiusMeters = this.config.get<number>("MAPS_NEARBY_RADIUS_METERS") ?? 5000;
    const maxResults = this.config.get<number>("MAPS_MAX_NEARBY_PER_CATEGORY") ?? 5;
    const fetchedAt = new Date();
    const nearbyExpiresAt = new Date(fetchedAt.getTime() +
      (this.config.get<number>("MAPS_NEARBY_CACHE_TTL_HOURS") ?? 720) * 3_600_000);
    const routeExpiresAt = new Date(fetchedAt.getTime() +
      (this.config.get<number>("MAPS_ROUTE_CACHE_TTL_HOURS") ?? 168) * 3_600_000);
    const collectedByKey = new Map<string, { category: NearbyPlaceCategory; place: ProviderNearbyPlace; straight: number; mode: TravelMode }>();
    let failedCategories = 0;

    for (const category of Object.values(NearbyPlaceCategory)) {
      try {
        const places = await this.maps.searchNearby({
          center: origin,
          includedTypes: CATEGORY_TYPES[category],
          radiusMeters,
          maxResults
        });
        for (const place of places) {
          const straight = Math.round(haversineDistanceMeters(origin, place.location));
          if (straight <= radiusMeters) {
            const key = this.routeKey(category, place.placeId);
            if (!collectedByKey.has(key)) {
              collectedByKey.set(key, { category, place, straight, mode: straight <= 2500 ? "walking" : "driving" });
            }
          }
        }
      } catch {
        failedCategories += 1;
      }
    }

    const collected = [...collectedByKey.values()];

    const routeValues = new Map<string, { distanceMeters: number | null; durationSeconds: number | null }>();
    for (const mode of ["walking", "driving"] as const) {
      const candidates = collected.filter((item) => item.mode === mode);
      if (candidates.length === 0) continue;
      try {
        const routes = await this.maps.computeRouteMatrix({
          origin,
          destinations: candidates.map((item) => item.place.location),
          travelMode: mode
        });
        routes.forEach((route) => {
          const candidate = candidates[route.destinationIndex];
          if (candidate) routeValues.set(this.routeKey(candidate.category, candidate.place.placeId), route);
        });
      } catch {
        // Route enrichment is optional; straight-line distance remains usable.
      }
    }

    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.listingLocation.findUnique({ where: { id: location.id } });
      if (!current || current.addressVersion !== location.addressVersion ||
        current.geocodeStatus !== LocationGeocodeStatus.verified) return;
      await transaction.nearbyPlace.deleteMany({
        where: { listingLocationId: location.id, addressVersion: location.addressVersion }
      });
      for (const [rank, item] of collected.entries()) {
        const route = routeValues.get(this.routeKey(item.category, item.place.placeId));
        await transaction.nearbyPlace.create({
          data: {
            listingId,
            listingLocationId: location.id,
            addressVersion: location.addressVersion,
            providerPlaceId: item.place.placeId,
            category: item.category,
            displayName: item.place.name,
            mapsUrl: item.place.mapsUrl,
            latitude: item.place.location.latitude,
            longitude: item.place.location.longitude,
            straightLineDistanceMeters: item.straight,
            routeDistanceMeters: route?.distanceMeters ?? null,
            routeDurationSeconds: route?.durationSeconds ?? null,
            routeMode: item.mode === "walking" ? MapsTravelMode.walking : MapsTravelMode.driving,
            provider: "google",
            fetchedAt,
            expiresAt: route ? routeExpiresAt : nearbyExpiresAt,
            rank
          }
        });
      }
      await transaction.listingLocation.update({
        where: { id: location.id },
        data: {
          enrichmentStatus: failedCategories === Object.values(NearbyPlaceCategory).length
            ? LocationEnrichmentStatus.failed : LocationEnrichmentStatus.ready,
          enrichmentVersion: location.addressVersion,
          nearbyEnrichedAt: fetchedAt,
          nearbyExpiresAt: collected.some((item) => routeValues.has(this.routeKey(item.category, item.place.placeId)))
            ? routeExpiresAt : nearbyExpiresAt,
          processingStartedAt: null
        }
      });
    });
    return { status: failedCategories > 0 ? "partial" as const : "ready" as const, count: collected.length };
  }

  async queueExpiredForRefresh(limit = 100) {
    await this.prisma.listingLocation.updateMany({
      where: {
        geocodeStatus: LocationGeocodeStatus.verified,
        geocodeExpiresAt: { lte: new Date() }
      },
      data: { geocodeStatus: LocationGeocodeStatus.stale }
    });
    const geocodesRefreshed = await this.retryFailed(limit);
    const expired = await this.prisma.listingLocation.findMany({
      where: {
        geocodeStatus: LocationGeocodeStatus.verified,
        OR: [{ nearbyExpiresAt: null }, { nearbyExpiresAt: { lte: new Date() } }]
      },
      select: { listingId: true, addressVersion: true },
      take: limit
    });
    for (const item of expired) {
      await this.prisma.listingLocation.update({
        where: { listingId: item.listingId },
        data: { enrichmentStatus: LocationEnrichmentStatus.pending }
      });
      await this.enrichListing(item.listingId, item.addressVersion);
    }
    return expired.length + geocodesRefreshed;
  }

  async retryFailed(limit = 100) {
    const locations = await this.prisma.listingLocation.findMany({
      where: { geocodeStatus: { in: [
        LocationGeocodeStatus.failed,
        LocationGeocodeStatus.ambiguous,
        LocationGeocodeStatus.pending,
        LocationGeocodeStatus.stale
      ] } },
      take: limit,
      orderBy: { updatedAt: "asc" }
    });
    let recovered = 0;
    for (const location of locations) {
      if (!location.inputAddress) continue;
      try {
        const result = await this.maps.geocodeAddress(location.inputAddress, location.inputPlaceId ?? undefined);
        if (result.status !== "verified") {
          await this.prisma.listingLocation.update({
            where: { id: location.id },
            data: {
              geocodeStatus: result.status === "ambiguous"
                ? LocationGeocodeStatus.ambiguous : LocationGeocodeStatus.failed,
              failureCategory: result.status,
              geocodeAttempts: { increment: 1 }
            }
          });
          continue;
        }
        const fingerprint = location.addressFingerprint ?? addressFingerprint(location.inputAddress);
        const secret = this.config.get<string>("MAPS_LOCATION_PRIVACY_SECRET");
        const listing = await this.prisma.listing.findUnique({
          where: { id: location.listingId },
          select: { publicLatitude: true, publicLongitude: true }
        });
        const approximate = listing?.publicLatitude !== null && listing?.publicLatitude !== undefined &&
          listing.publicLongitude !== null && listing.publicLongitude !== undefined
          ? { latitude: Number(listing.publicLatitude), longitude: Number(listing.publicLongitude) }
          : secret ? stableApproximateCoordinates({
              listingId: location.listingId,
              fingerprint,
              secret,
              latitude: result.latitude,
              longitude: result.longitude
            }) : null;
        await this.prisma.$transaction([
          this.prisma.listing.update({
            where: { id: location.listingId },
            data: {
              ...(location.inputCity ? { city: location.inputCity } : {}),
              address: result.formattedAddress,
              latitude: result.latitude,
              longitude: result.longitude,
              publicLatitude: approximate?.latitude ?? null,
              publicLongitude: approximate?.longitude ?? null
            }
          }),
          this.prisma.listingLocation.update({
            where: { id: location.id },
            data: {
              geocodeStatus: LocationGeocodeStatus.verified,
              addressFingerprint: fingerprint,
              verifiedFingerprint: fingerprint,
              formattedAddress: result.formattedAddress,
              providerPlaceId: result.placeId,
              exactLatitude: result.latitude,
              exactLongitude: result.longitude,
              precision: this.toPrecision(result.precision),
              provider: "google",
              verifiedAddressVersion: location.addressVersion,
              geocodedAt: new Date(),
              geocodeExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
              failureCategory: null,
              geocodeAttempts: { increment: 1 },
              enrichmentStatus: LocationEnrichmentStatus.pending
            }
          })
        ]);
        await this.enrichListing(location.listingId, location.addressVersion);
        recovered += 1;
      } catch {
        await this.prisma.listingLocation.update({
          where: { id: location.id },
          data: { geocodeStatus: LocationGeocodeStatus.failed, failureCategory: "unavailable", geocodeAttempts: { increment: 1 } }
        });
      }
    }
    return recovered;
  }

  private assertAddress(value: string) {
    if (value.length < 8 || value.length > 420 || value.split(" ").length < 2) {
      throw new BadRequestException({
        code: "LISTING_LOCATION_INVALID",
        message: "A complete listing address and city are required.",
        details: {}
      });
    }
  }
  private toPrecision(value: GeocodePrecision) {
    return LocationPrecision[value];
  }
  private routeKey(category: NearbyPlaceCategory, placeId: string) {
    return `${category}:${placeId}`;
  }
}
