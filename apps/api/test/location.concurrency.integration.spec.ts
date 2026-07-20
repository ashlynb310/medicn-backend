import { ConfigService } from "@nestjs/config";
import { BookingStatus, ListingStatus, LocationEnrichmentStatus } from "@prisma/client";
import { LocationService } from "../src/maps/location.service";
import type { MapsService } from "../src/maps/maps.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("LocationService PostgreSQL concurrency", () => {
  let prisma: PrismaService;
  let listingId: string;
  let renterId: string;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests.");
    prisma = new PrismaService();
    await prisma.$connect();
    const host = await prisma.user.create({
      data: {
        supabaseUserId: `maps-host-${suffix}`,
        email: `maps-host-${suffix}@example.com`,
        roles: ["host"]
      }
    });
    const renter = await prisma.user.create({
      data: {
        supabaseUserId: `maps-renter-${suffix}`,
        email: `maps-renter-${suffix}@example.com`,
        roles: ["renter"]
      }
    });
    renterId = renter.id;
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: "Maps concurrency fixture",
        description: "Location enrichment integration fixture.",
        city: "Houston",
        address: "100 Main St, Houston, TX 77002",
        latitude: 29.75,
        longitude: -95.37,
        publicLatitude: 29.753,
        publicLongitude: -95.37,
        priceCents: 10000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved,
        location: {
          create: {
            inputAddress: "100 Main St, Houston, TX 77002",
            addressFingerprint: `maps-${suffix}`,
            verifiedFingerprint: `maps-${suffix}`,
            formattedAddress: "100 Main St, Houston, TX 77002",
            providerPlaceId: `maps-place-${suffix}`,
            exactLatitude: 29.75,
            exactLongitude: -95.37,
            geocodeStatus: "verified",
            precision: "rooftop",
            provider: "integration-test",
            addressVersion: 1,
            verifiedAddressVersion: 1,
            geocodedAt: new Date(),
            enrichmentStatus: LocationEnrichmentStatus.pending
          }
        }
      }
    });
    listingId = listing.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.bookingLocationSnapshot.deleteMany({ where: { booking: { listingId } } });
    await prisma.booking.deleteMany({ where: { listingId } });
    await prisma.nearbyPlace.deleteMany({ where: { listingId } });
    await prisma.listingLocation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { supabaseUserId: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  it("claims one active enrichment job per listing/address version", async () => {
    const maps = {
      searchNearby: jest.fn().mockResolvedValue([]),
      computeRouteMatrix: jest.fn()
    };
    const service = new LocationService(
      prisma,
      maps as unknown as MapsService,
      new ConfigService({
        MAPS_NEARBY_RADIUS_METERS: 5000,
        MAPS_MAX_NEARBY_PER_CATEGORY: 5,
        MAPS_NEARBY_CACHE_TTL_HOURS: 720,
        MAPS_ROUTE_CACHE_TTL_HOURS: 168
      })
    );

    const results = await Promise.all([
      service.enrichListing(listingId, 1),
      service.enrichListing(listingId, 1)
    ]);
    expect(results.filter((result) => result.status === "ready")).toHaveLength(1);
    expect(results.filter((result) => result.status === "skipped")).toHaveLength(1);
    expect(maps.searchNearby).toHaveBeenCalledTimes(4);
  });

  it("keeps a paid booking snapshot unchanged after the listing moves", async () => {
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    const booking = await prisma.booking.create({
      data: {
        listingId,
        renterId,
        hostId: listing.hostId,
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
        selectedOption: "daily",
        status: BookingStatus.paid,
        totalAmountCents: 10000,
        locationSnapshot: {
          create: {
            formattedAddress: listing.address!,
            exactLatitude: listing.latitude,
            exactLongitude: listing.longitude,
            sourceListingLocationVersion: 1
          }
        }
      }
    });
    await prisma.listing.update({
      where: { id: listingId },
      data: { address: "999 Changed St", latitude: 1, longitude: 2 }
    });
    const snapshot = await prisma.bookingLocationSnapshot.findUniqueOrThrow({
      where: { bookingId: booking.id }
    });
    expect(snapshot.formattedAddress).toBe("100 Main St, Houston, TX 77002");
    expect(Number(snapshot.exactLatitude)).toBe(29.75);
    expect(Number(snapshot.exactLongitude)).toBe(-95.37);
  });
});
