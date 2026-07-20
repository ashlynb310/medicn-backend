import { AvailabilityStatus, BookingStatus, ListingStatus, UserRole } from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { ListingAvailabilityService } from "../src/listings/listing-availability.service";
import type { PrismaService } from "../src/prisma/prisma.service";

describe("ListingAvailabilityService", () => {
  const host = {
    id: "host-1",
    roles: [UserRole.host]
  };

  interface TestPrisma {
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
    listing: { findFirst: jest.Mock };
    listingAvailability: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    booking: { findMany: jest.Mock };
  }

  function setup(overrides?: {
    listing?: Record<string, unknown> | null;
    windows?: Array<Record<string, unknown>>;
    reservations?: Array<Record<string, unknown>>;
  }) {
    const listing =
      overrides?.listing === undefined
        ? {
            id: "listing-1",
            hostId: host.id,
            timeZone: "America/Chicago",
            status: ListingStatus.approved,
            deletedAt: null
          }
        : overrides.listing;
    const prisma: TestPrisma = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      listing: { findFirst: jest.fn().mockResolvedValue(listing) },
      listingAvailability: {
        count: jest.fn().mockResolvedValue(overrides?.windows?.length ?? 0),
        findMany: jest.fn().mockResolvedValue(overrides?.windows ?? []),
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "window-new",
          ...data
        })),
        update: jest.fn(),
        delete: jest.fn()
      },
      booking: {
        findMany: jest.fn().mockResolvedValue(overrides?.reservations ?? [])
      }
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: TestPrisma) => unknown) => callback(prisma)
    );
    const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(host) };
    return {
      prisma,
      service: new ListingAvailabilityService(
        prisma as unknown as PrismaService,
        auth as unknown as AuthService
      )
    };
  }

  it("returns opaque NOT_FOUND when an authenticated Host does not own the listing", async () => {
    const { service } = setup({
      listing: { id: "listing-1", hostId: "other-host", timeZone: "UTC" }
    });
    await expect(service.listWindows("token", "listing-1", {})).rejects.toMatchObject({
      response: { code: "NOT_FOUND", details: {} }
    });
  });

  it("rejects a blocked window that overlaps a requested reservation", async () => {
    const { service, prisma } = setup({
      reservations: [
        {
          startDate: new Date("2026-09-10T00:00:00.000Z"),
          endDate: new Date("2026-09-12T00:00:00.000Z"),
          status: BookingStatus.requested
        }
      ]
    });
    await expect(
      service.createWindow("token", "listing-1", {
        startDate: "2026-09-11",
        endDate: "2026-09-13",
        status: "blocked"
      })
    ).rejects.toMatchObject({
      response: {
        code: "AVAILABILITY_CONFLICTS_WITH_RESERVATION",
        details: { startDate: "2026-09-10", endDate: "2026-09-12" }
      }
    });
    expect(prisma.listingAvailability.create).not.toHaveBeenCalled();
  });

  it("creates an available half-open window without exposing a reservation type", async () => {
    const { service } = setup();
    await expect(
      service.createWindow("token", "listing-1", {
        startDate: "2026-10-01",
        endDate: "2026-10-05",
        status: "available"
      })
    ).resolves.toEqual({
      id: "window-new",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      status: AvailabilityStatus.available
    });
  });

  it("returns a public projection containing only timezone, query range, and unavailable dates", async () => {
    const { service } = setup({
      windows: [
        {
          id: "blocked-1",
          startDate: new Date("2026-11-03T00:00:00.000Z"),
          endDate: new Date("2026-11-04T00:00:00.000Z"),
          status: AvailabilityStatus.blocked
        }
      ],
      reservations: [
        {
          bookingId: "must-not-leak",
          renterId: "must-not-leak",
          startDate: new Date("2026-11-06T00:00:00.000Z"),
          endDate: new Date("2026-11-08T00:00:00.000Z")
        }
      ]
    });
    const result = await service.getPublicCalendar("listing-1", {
      startDate: "2026-11-01",
      endDate: "2026-11-10"
    });
    expect(result).toEqual({
      timeZone: "America/Chicago",
      range: { startDate: "2026-11-01", endDate: "2026-11-10" },
      unavailable: [
        { startDate: "2026-11-03", endDate: "2026-11-04" },
        { startDate: "2026-11-06", endDate: "2026-11-08" }
      ]
    });
    expect(JSON.stringify(result)).not.toMatch(/bookingId|renterId|address|payment/);
  });

  it("bounds public calendar queries", async () => {
    const { service } = setup();
    await expect(
      service.getPublicCalendar("listing-1", {
        startDate: "2026-01-01",
        endDate: "2028-01-01"
      })
    ).rejects.toMatchObject({
      response: { code: "CALENDAR_RANGE_TOO_LARGE", details: {} }
    });
  });
});
