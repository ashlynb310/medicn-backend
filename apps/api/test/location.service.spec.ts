import { ConfigService } from "@nestjs/config";
import {
  LocationEnrichmentStatus,
  LocationGeocodeStatus,
  NearbyPlaceCategory
} from "@prisma/client";
import { LocationService } from "../src/maps/location.service";
import type { MapsService } from "../src/maps/maps.service";
import type { PrismaService } from "../src/prisma/prisma.service";

function createService() {
  const location = {
    id: "location_1",
    listingId: "listing_1",
    inputAddress: "100 Main St, Houston",
    inputPlaceId: null,
    addressFingerprint: "fingerprint",
    verifiedFingerprint: "fingerprint",
    formattedAddress: "100 Main St, Houston, TX",
    providerPlaceId: "origin_place",
    exactLatitude: 29.75,
    exactLongitude: -95.37,
    geocodeStatus: LocationGeocodeStatus.verified,
    precision: "rooftop",
    provider: "google",
    addressVersion: 2,
    verifiedAddressVersion: 2,
    geocodedAt: new Date(),
    geocodeExpiresAt: new Date(Date.now() + 10_000),
    failureCategory: null,
    geocodeAttempts: 1,
    enrichmentStatus: LocationEnrichmentStatus.pending,
    enrichmentVersion: null,
    nearbyEnrichedAt: null,
    nearbyExpiresAt: null,
    processingStartedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
    ,listing: { publicLatitude: 29.753, publicLongitude: -95.37 }
  };
  const database = {
    $executeRaw: jest.fn(),
    listingLocation: {
      findUnique: jest.fn().mockResolvedValue(location),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn()
    },
    nearbyPlace: {
      deleteMany: jest.fn(),
      create: jest.fn()
    }
  };
  const prisma = {
    ...database,
    $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback(database))
  };
  const maps = {
    geocodeAddress: jest.fn(),
    searchNearby: jest.fn()
      .mockResolvedValueOnce([{
        placeId: "hospital_1",
        name: "Memorial Hospital",
        mapsUrl: "https://maps.google.com/?cid=1",
        location: { latitude: 29.751, longitude: -95.37 },
        types: ["hospital"]
      }, {
        placeId: "hospital_1",
        name: "Memorial Hospital duplicate",
        mapsUrl: "https://maps.google.com/?cid=1",
        location: { latitude: 29.751, longitude: -95.37 },
        types: ["hospital"]
      }])
      .mockResolvedValue([]),
    computeRouteMatrix: jest.fn().mockResolvedValue([{
      destinationIndex: 0,
      distanceMeters: 150,
      durationSeconds: 120
    }])
  };
  const config = new ConfigService({
    MAPS_NEARBY_RADIUS_METERS: 5000,
    MAPS_MAX_NEARBY_PER_CATEGORY: 5,
    MAPS_NEARBY_CACHE_TTL_HOURS: 720,
    MAPS_PUBLIC_DISTANCE_ROUNDING_METERS: 100
  });
  const service = new LocationService(
    prisma as unknown as PrismaService,
    maps as unknown as MapsService,
    config
  );
  return { service, prisma, maps, location };
}

describe("LocationService enrichment", () => {
  it("stores allowlisted nearby results and optional route facts without exposing an origin", async () => {
    const { service, prisma, maps } = createService();
    await expect(service.enrichListing("listing_1", 2)).resolves.toEqual({
      status: "ready",
      count: 1
    });

    expect(maps.searchNearby).toHaveBeenCalledTimes(4);
    expect(maps.searchNearby).toHaveBeenNthCalledWith(1, expect.objectContaining({
      includedTypes: ["hospital", "general_hospital", "medical_center"],
      center: { latitude: 29.753, longitude: -95.37 }
    }));
    expect(maps.computeRouteMatrix).toHaveBeenCalledWith(expect.objectContaining({
      origin: { latitude: 29.753, longitude: -95.37 }
    }));
    expect(prisma.nearbyPlace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: NearbyPlaceCategory.medical,
        providerPlaceId: "hospital_1",
        routeDistanceMeters: 150,
        routeDurationSeconds: 120,
        addressVersion: 2
      })
    });
    expect(prisma.listingLocation.update).toHaveBeenLastCalledWith({
      where: { id: "location_1" },
      data: expect.objectContaining({
        enrichmentStatus: LocationEnrichmentStatus.ready,
        enrichmentVersion: 2
      })
    });
  });

  it("drops a stale job before any provider call", async () => {
    const { service, prisma, maps, location } = createService();
    prisma.listingLocation.findUnique.mockResolvedValue({ ...location, addressVersion: 3 });

    await expect(service.enrichListing("listing_1", 2)).resolves.toEqual({ status: "skipped" });
    expect(maps.searchNearby).not.toHaveBeenCalled();
    expect(prisma.nearbyPlace.create).not.toHaveBeenCalled();
  });

  it("keeps successful categories when one provider category fails", async () => {
    const { service, prisma, maps } = createService();
    maps.searchNearby.mockReset()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue([]);

    await expect(service.enrichListing("listing_1", 2)).resolves.toEqual({
      status: "partial",
      count: 0
    });
    expect(prisma.listingLocation.update).toHaveBeenLastCalledWith({
      where: { id: "location_1" },
      data: expect.objectContaining({ enrichmentStatus: LocationEnrichmentStatus.ready })
    });
  });

  it("classifies ambiguous geocoding without persisting provider coordinates", async () => {
    const { service, maps } = createService();
    maps.geocodeAddress.mockResolvedValue({ status: "ambiguous" });
    await expect(service.verifyInput("100 Main St", "Houston")).resolves.toMatchObject({
      status: "ambiguous",
      failureCategory: "ambiguous"
    });
  });
});
