import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AvailabilityStatus,
  BookingStatus,
  LocationEnrichmentStatus,
  LocationGeocodeStatus,
  ListingPlaceType,
  ListingStatus,
  ListingType,
  MediaAssetStatus,
  PriceUnit,
  Prisma,
  ProximityTag,
  SpecialFeature,
  StayDuration,
  UserRole,
  type User
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { JobsService } from "../jobs/jobs.service";
import { addressFingerprint, normalizeAddress, roundPublicDistance, stableApproximateCoordinates } from "../maps/geo";
import { LocationService, type LocationVerification } from "../maps/location.service";
import { MapsService, type ResolvedPlace } from "../maps/maps.service";
import { ENRICH_LISTING_LOCATION_JOB } from "../maps/maps.types";
import { PrismaService } from "../prisma/prisma.service";
import type { AddListingPhotoDto } from "./dto/add-listing-photo.dto";
import type {
  CreateListingDto,
  ListingAvailabilityDto
} from "./dto/create-listing.dto";
import type { SearchListingsQueryDto } from "./dto/search-listings-query.dto";
import type { ListMyListingsQueryDto } from "./dto/list-my-listings-query.dto";
import type {
  ExactListingLocationDto,
  PublicListingLocationDto
} from "./dto/listing-location.dto";
import type {
  UpdateListingAvailabilityDto,
  UpdateListingDto
} from "./dto/update-listing.dto";
import {
  formatCivilDate,
  isValidIanaTimeZone,
  parseCivilDate
} from "./availability-calendar";

const listingInclude = {
  host: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      bio: true,
      profilePhotoUrl: true
    }
  },
  photos: {
    where: {
      deletedAt: null,
      OR: [
        { legacyUnprocessed: true },
        { mediaAsset: { status: MediaAssetStatus.ready } }
      ]
    },
    orderBy: { displayOrder: "asc" as const }
  },
  availability: {
    orderBy: { startDate: "asc" as const }
  },
  places: {
    orderBy: { displayOrder: "asc" as const }
  },
  location: true,
  nearbyPlaces: {
    orderBy: [{ category: "asc" as const }, { rank: "asc" as const }]
  }
} satisfies Prisma.ListingInclude;

type ListingWithRelations = Prisma.ListingGetPayload<{
  include: typeof listingInclude;
}>;

type ApiUserRole = "renter" | "host" | "admin";

const PUBLIC_LOCATION_RADIUS_METERS = 500;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @Optional() private readonly mapsService?: MapsService,
    @Optional() private readonly locationService?: LocationService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly jobs?: JobsService
  ) {}

  async searchListings(query: SearchListingsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = await this.toSearchWhere(query);
    const orderBy = this.toSearchOrderBy(query.sort);

    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      data: listings.map((listing) => this.toListingSummaryDto(listing, false)),
      meta: {
        page,
        limit,
        total
      },
      error: null
    };
  }

  async getListing(id: string, token?: string) {
    const publicListing = await this.prisma.listing.findFirst({
      where: {
        id,
        status: ListingStatus.approved,
        deletedAt: null
      },
      include: listingInclude
    });

    if (publicListing) {
      if (!token) {
        return this.toListingDetailDto(publicListing, false);
      }

      const currentUser = await this.authService.getCurrentUserRecord(token);
      const canViewExactLocation =
        this.hasRole(currentUser, "admin") ||
        publicListing.hostId === currentUser.id;
      return this.toListingDetailDto(publicListing, canViewExactLocation);
    }

    if (!token) {
      throw this.notFoundException();
    }

    const currentUser = await this.authService.getCurrentUserRecord(token);
    const ownerListing = await this.prisma.listing.findFirst({
      where: {
        id,
        deletedAt: null
      },
      include: listingInclude
    });

    if (
      !ownerListing ||
      (!this.hasRole(currentUser, "admin") && ownerListing.hostId !== currentUser.id)
    ) {
      throw this.notFoundException();
    }

    return this.toListingDetailDto(ownerListing, true);
  }

  async listMyListings(token: string, query: ListMyListingsQueryDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertHost(currentUser, "Only hosts can view their own listings.");

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ListingWhereInput = {
      hostId: currentUser.id,
      deletedAt: null,
      ...(query.status ? { status: ListingStatus[query.status] } : {})
    };

    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      data: listings.map((listing) => this.toListingSummaryDto(listing, true)),
      meta: {
        page,
        limit,
        total
      },
      error: null
    };
  }

  async createListing(token: string, input: CreateListingDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertHost(currentUser);
    this.assertNoClientCoordinates(input);
    const city = this.requiredString(input.city, "city");
    const timeZone = this.requiredTimeZone(input.timeZone);
    const checkoutTime = this.checkoutTime(input.checkoutTime);
    const address = this.requiredString(input.address ?? "", "address");
    const listingId = randomUUID();
    const verification = await this.verifyLocation(address, city, input.placeId);
    const publicCoordinates = this.publicCoordinates(listingId, verification);
    const placesCreate = await this.optionalPlacesCreate(
      input.neighborhoodPerks,
      input.localRecommendations,
      city
    );

    return this.prisma.$transaction(async (transaction) => {
      const listing = await transaction.listing.create({
        data: {
        id: listingId,
        hostId: currentUser.id,
        title: this.requiredString(input.title, "title"),
        description: this.requiredString(input.description, "description"),
        city,
        timeZone,
        checkoutTime,
        address: verification.status === "verified" ? verification.formattedAddress : null,
        latitude: verification.status === "verified" ? verification.latitude : null,
        longitude: verification.status === "verified" ? verification.longitude : null,
        publicLatitude: publicCoordinates.latitude,
        publicLongitude: publicCoordinates.longitude,
        publicRadiusMeters: PUBLIC_LOCATION_RADIUS_METERS,
        priceCents: input.priceCents,
        priceUnit: PriceUnit[input.priceUnit],
        listingType: ListingType[input.listingType],
        category: this.optionalString(input.category),
        status: ListingStatus.pending,
        stayDurations: this.toStayDurations(input.stayDurations),
        proximityTags: this.toProximityTags(input.proximityTags),
        specialFeatures: this.toSpecialFeatures(input.specialFeatures),
        ...this.optionalAvailabilityCreate(input.availability),
        ...placesCreate,
        location: { create: this.locationCreateData(verification, input.placeId, city) }
      },
      select: {
        id: true,
        status: true
      }
      });
      if (verification.status === "verified") {
        await this.enqueueEnrichment(transaction, listingId, 1);
      }
      return listing;
    });
  }

  async updateListing(token: string, id: string, input: UpdateListingDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertNoClientCoordinates(input);
    const listing = await this.findEditableListing(id);
    this.assertHostOwnerOrAdmin(currentUser, listing.hostId);
    if (input.availability !== undefined) {
      throw new BadRequestException({
        code: "AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED",
        message: "Use the dedicated listing availability endpoints.",
        details: {}
      });
    }
    if ((input.city !== undefined || input.placeId !== undefined) && input.address === undefined) {
      throw new BadRequestException({
        code: "LISTING_LOCATION_INVALID",
        message: "Address is required when changing the listing city or place selection.",
        details: {}
      });
    }
    const requestedAddress = input.address ?? listing.location?.inputAddress ?? listing.address ?? "";
    const requestedCity = input.city ?? listing.city;
    const requestedFingerprint = addressFingerprint(normalizeAddress(`${requestedAddress}, ${requestedCity}`));
    const locationChanged =
      (input.address !== undefined || input.city !== undefined || input.placeId !== undefined) &&
      (requestedFingerprint !== listing.location?.addressFingerprint ||
        (input.placeId !== undefined && input.placeId !== listing.location?.inputPlaceId));
    if (locationChanged) {
      if (!this.locationService) return this.legacyUpdateListingLocation(listing, input);
      await this.assertLocationChangeAllowed(id);
      return this.updateListingWithLocation(currentUser, listing, input);
    }
    const data = await this.toListingUpdateData(input, listing);

    if (Object.keys(data).length === 0) {
      return this.toListingDetailDto(listing, true);
    }

    const updatedListing = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`
      );
      const locked = await transaction.listing.findFirst({
        where: { id, deletedAt: null },
        select: { hostId: true }
      });
      if (!locked) throw this.notFoundException();
      this.assertHostOwnerOrAdmin(currentUser, locked.hostId);
      return transaction.listing.update({
        where: { id },
        data,
        include: listingInclude
      });
    });

    return this.toListingDetailDto(updatedListing, true);
  }

  async deleteListing(token: string, id: string) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`
      );
      const listing = await transaction.listing.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, hostId: true }
      });
      if (!listing) throw this.notFoundException();
      this.assertHostOwnerOrAdmin(currentUser, listing.hostId);

      const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>(
        Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`
      );
      if (!databaseClock) {
        throw new Error("Database current time was unavailable.");
      }
      const { now } = databaseClock;
      const activeBooking = await transaction.booking.findFirst({
        where: {
          listingId: id,
          status: {
            in: [
              BookingStatus.requested,
              BookingStatus.accepted,
              BookingStatus.payment_pending,
              BookingStatus.paid
            ]
          },
          endDate: { gt: now }
        },
        select: { id: true }
      });
      if (activeBooking) {
        throw new ConflictException({
          code: "LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS",
          message: "This listing cannot be archived while it has active booking obligations.",
          details: {}
        });
      }

      const archivedListing = await transaction.listing.update({
        where: { id },
        data: {
          status: ListingStatus.archived,
          deletedAt: now
        },
        select: {
          id: true,
          status: true,
          deletedAt: true
        }
      });

      return {
        id: archivedListing.id,
        status: archivedListing.status,
        deletedAt: archivedListing.deletedAt?.toISOString() ?? null
      };
    });
  }

  async addListingPhoto(
    token: string,
    id: string,
    input: AddListingPhotoDto
  ) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const listing = await this.findEditableListing(id);
    this.assertHostOwnerOrAdmin(currentUser, listing.hostId);
    void input;
    throw new BadRequestException({
      code: "MEDIA_PROCESSING_REQUIRED",
      message: "Listing photos are published only by the media processor.",
      details: {}
    });
  }

  private async toSearchWhere(
    query: SearchListingsQueryDto
  ): Promise<Prisma.ListingWhereInput> {
    const where: Prisma.ListingWhereInput = {
      status: ListingStatus.approved,
      deletedAt: null
    };
    const andFilters: Prisma.ListingWhereInput[] = [];

    if (query.city) {
      where.city = { contains: query.city, mode: "insensitive" };
    }

    if (query.location) {
      andFilters.push({
        OR: [
          { city: { contains: query.location, mode: "insensitive" } },
          { title: { contains: query.location, mode: "insensitive" } }
        ]
      });
    }

    if (query.nearbyHospital) {
      where.places = {
        some: {
          label: { contains: query.nearbyHospital, mode: "insensitive" }
        }
      };
    }

    if (query.listingType) {
      where.listingType = ListingType[query.listingType];
    }

    if (query.category) {
      where.category = { contains: query.category, mode: "insensitive" };
    }

    if (query.stayDuration) {
      where.stayDurations = { has: StayDuration[query.stayDuration] };
    }

    if (query.priceUnit) {
      where.priceUnit = PriceUnit[query.priceUnit];
    }

    const priceFilter = this.toPriceFilter(query.minPrice, query.maxPrice);
    if (priceFilter) {
      where.priceCents = priceFilter;
    }

    const availabilityListingIds = await this.toAvailabilityListingIds(
      query.startDate,
      query.endDate
    );
    if (availabilityListingIds) {
      andFilters.push({ id: { in: availabilityListingIds } });
    }

    const boundsFilter = this.toBoundsFilter(query.bounds);
    if (boundsFilter) {
      andFilters.push(boundsFilter);
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    return where;
  }

  private toSearchOrderBy(sort: SearchListingsQueryDto["sort"]) {
    if (sort === "price_asc") {
      return { priceCents: "asc" as const };
    }

    if (sort === "price_desc") {
      return { priceCents: "desc" as const };
    }

    return { createdAt: "desc" as const };
  }

  private toPriceFilter(minPrice?: number, maxPrice?: number) {
    if (minPrice === undefined && maxPrice === undefined) {
      return undefined;
    }

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      throw this.validationException("minPrice cannot be greater than maxPrice.");
    }

    return {
      ...(minPrice !== undefined ? { gte: this.priceToCents(minPrice) } : {}),
      ...(maxPrice !== undefined ? { lte: this.priceToCents(maxPrice) } : {})
    };
  }

  private async toAvailabilityListingIds(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) {
      return undefined;
    }

    if (!startDate || !endDate) {
      throw this.validationException(
        "Both startDate and endDate are required for availability search."
      );
    }

    const start = this.parseDate(startDate);
    const end = this.parseDate(endDate);

    if (end <= start) {
      throw this.validationException("endDate must be after startDate.");
    }
    if ((end.getTime() - start.getTime()) / 86_400_000 > 366) {
      throw new BadRequestException({
        code: "CALENDAR_RANGE_TOO_LARGE",
        message: "Listing search date ranges may cover at most 366 days.",
        details: {}
      });
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT listing."id"
      FROM "Listing" AS listing
      WHERE NOT EXISTS (
        SELECT 1 FROM "ListingAvailability" AS blocked
        WHERE blocked."listingId" = listing."id"
          AND blocked."status" = 'blocked'::"AvailabilityStatus"
          AND blocked."startDate" < ${end}::date
          AND blocked."endDate" > ${start}::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Booking" AS booking
        WHERE booking."listingId" = listing."id"
          AND booking."status" IN (
            'requested'::"BookingStatus", 'accepted'::"BookingStatus",
            'payment_pending'::"BookingStatus", 'paid'::"BookingStatus"
          )
          AND booking."startDate" < ${end}::date
          AND booking."endDate" > ${start}::date
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM "ListingAvailability" AS available
          WHERE available."listingId" = listing."id"
            AND available."status" = 'available'::"AvailabilityStatus"
        )
        OR COALESCE((
          SELECT range_agg(daterange(available."startDate", available."endDate", '[)'))
          FROM "ListingAvailability" AS available
          WHERE available."listingId" = listing."id"
            AND available."status" = 'available'::"AvailabilityStatus"
        ) @> daterange(${start}::date, ${end}::date, '[)'), false)
      )
    `);
    return rows.map(({ id }) => id);
  }

  private toBoundsFilter(bounds?: string): Prisma.ListingWhereInput | undefined {
    if (!bounds) {
      return undefined;
    }

    const values = bounds.split(",").map((value) => Number(value.trim()));

    if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
      throw this.validationException(
        "bounds must use north,east,south,west numeric format."
      );
    }

    const [north, east, south, west] = values as [
      number,
      number,
      number,
      number
    ];

    if (south > north || west > east) {
      throw this.validationException("bounds coordinates are invalid.");
    }

    return {
      publicLatitude: {
        gte: south,
        lte: north
      },
      publicLongitude: {
        gte: west,
        lte: east
      }
    };
  }

  private async toListingUpdateData(
    input: UpdateListingDto,
    currentListing: ListingWithRelations
  ): Promise<Prisma.ListingUpdateInput> {
    const city = input.city ?? currentListing.city;
    const data: Prisma.ListingUpdateInput = {
      ...this.optionalUpdateString("title", input.title, true),
      ...this.optionalUpdateString("description", input.description, true),
      ...(input.priceCents !== undefined
        ? { priceCents: input.priceCents }
        : {}),
      ...(input.priceUnit !== undefined
        ? { priceUnit: PriceUnit[input.priceUnit] }
        : {}),
      ...(input.listingType !== undefined
        ? { listingType: ListingType[input.listingType] }
        : {}),
      ...this.optionalUpdateString("category", input.category, false),
      ...(input.stayDurations !== undefined
        ? { stayDurations: this.toStayDurations(input.stayDurations) }
        : {}),
      ...(input.proximityTags !== undefined
        ? { proximityTags: this.toProximityTags(input.proximityTags) }
        : {}),
      ...(input.specialFeatures !== undefined
        ? { specialFeatures: this.toSpecialFeatures(input.specialFeatures) }
        : {}),
      ...(input.timeZone !== undefined
        ? { timeZone: this.requiredTimeZone(input.timeZone) }
        : {}),
      ...(input.checkoutTime !== undefined
        ? { checkoutTime: this.checkoutTime(input.checkoutTime) }
        : {})
    };

    const placesUpdate = await this.toPlacesUpdate(
      input.neighborhoodPerks,
      input.localRecommendations,
      city
    );
    if (placesUpdate) {
      data.places = placesUpdate;
    }

    return data;
  }

  private async updateListingWithLocation(
    currentUser: User,
    listing: ListingWithRelations,
    input: UpdateListingDto
  ) {
    void currentUser;
    const city = this.requiredString(input.city ?? listing.city, "city");
    const address = this.requiredString(
      input.address ?? listing.location?.inputAddress ?? listing.address ?? "",
      "address"
    );
    const verification = await this.verifyLocation(address, city, input.placeId);
    const currentVersion = listing.location?.addressVersion ?? 0;
    const addressVersion = currentVersion + 1;
    const publicCoordinates = this.publicCoordinates(listing.id, verification);
    const regularData = await this.toListingUpdateData(
      { ...input, address: undefined, city: undefined, placeId: undefined },
      listing
    );

    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${listing.id}, 0))`
      );
      await transaction.listing.update({
        where: { id: listing.id },
        data: {
          ...regularData,
          status: listing.status === ListingStatus.approved && verification.status === "verified"
            ? ListingStatus.pending : listing.status,
          ...(verification.status === "verified"
            ? {
                city,
                address: verification.formattedAddress,
                latitude: verification.latitude,
                longitude: verification.longitude,
                publicLatitude: publicCoordinates.latitude,
                publicLongitude: publicCoordinates.longitude,
                publicRadiusMeters: PUBLIC_LOCATION_RADIUS_METERS
              }
            : {})
        }
      });

      await transaction.listingLocation.upsert({
        where: { listingId: listing.id },
        create: {
          listingId: listing.id,
          ...this.locationCreateData(verification, input.placeId, city),
          addressVersion
        },
        update: {
          inputAddress: verification.normalizedAddress,
          inputCity: city,
          inputPlaceId: input.placeId ?? null,
          addressFingerprint: verification.fingerprint,
          addressVersion,
          geocodeStatus: verification.status === "verified"
            ? LocationGeocodeStatus.verified
            : verification.status === "ambiguous"
              ? LocationGeocodeStatus.ambiguous
              : LocationGeocodeStatus.failed,
          failureCategory: verification.status === "verified" ? null : verification.failureCategory,
          geocodeAttempts: { increment: 1 },
          enrichmentStatus: verification.status === "verified"
            ? LocationEnrichmentStatus.pending
            : LocationEnrichmentStatus.stale,
          enrichmentVersion: null,
          nearbyExpiresAt: null,
          ...(verification.status === "verified"
            ? {
                verifiedFingerprint: verification.fingerprint,
                formattedAddress: verification.formattedAddress,
                providerPlaceId: verification.providerPlaceId,
                exactLatitude: verification.latitude,
                exactLongitude: verification.longitude,
                precision: verification.precision,
                provider: "google",
                verifiedAddressVersion: addressVersion,
                geocodedAt: new Date(),
                geocodeExpiresAt: this.providerCoordinateExpiry()
              }
            : {})
        }
      });
      if (verification.status === "verified") {
        await this.enqueueEnrichment(transaction, listing.id, addressVersion);
      }
      return transaction.listing.findUniqueOrThrow({ where: { id: listing.id }, include: listingInclude });
    });
    return this.toListingDetailDto(updated, true);
  }

  private optionalUpdateString(
    key: string,
    value: string | undefined,
    required: boolean
  ) {
    if (value === undefined) {
      return {};
    }

    if (!required) {
      return { [key]: this.optionalString(value) };
    }

    return { [key]: this.requiredString(value, key) };
  }

  private async findEditableListing(id: string) {
    const listing = await this.prisma.listing.findFirst({
      where: {
        id,
        deletedAt: null
      },
      include: listingInclude
    });

    if (!listing) {
      throw this.notFoundException();
    }

    return listing;
  }

  private assertHost(
    user: User,
    message = "Only hosts can create listings."
  ) {
    if (!this.hasRole(user, "host") && !this.hasRole(user, "admin")) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message,
        details: {}
      });
    }
  }

  private assertHostOwnerOrAdmin(user: User, hostId: string) {
    if (this.hasRole(user, "admin")) {
      return;
    }

    if (this.hasRole(user, "host") && user.id === hostId) {
      return;
    }

    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "You do not have permission to modify this listing.",
      details: {}
    });
  }

  private hasRole(user: User, role: ApiUserRole) {
    return user.roles.includes(UserRole[role]);
  }

  private requiredString(value: string, field: string) {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw this.validationException(`${field} is required.`);
    }

    return trimmed;
  }

  private requiredTimeZone(value: string) {
    const timeZone = this.requiredString(value, "timeZone");
    if (!isValidIanaTimeZone(timeZone)) {
      throw new BadRequestException({
        code: "LISTING_TIMEZONE_INVALID",
        message: "timeZone must be a canonical IANA timezone.",
        details: {}
      });
    }
    return timeZone;
  }

  private checkoutTime(value: string | undefined) {
    const checkoutTime = value ?? "11:00";
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(checkoutTime)) {
      throw this.validationException(
        "checkoutTime must use canonical local HH:mm time."
      );
    }
    return checkoutTime;
  }

  private optionalString(value: string | undefined) {
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private toStayDurations(values: string[] | undefined) {
    return values?.map((value) => StayDuration[value as keyof typeof StayDuration]) ?? [];
  }

  private toProximityTags(values: string[] | undefined) {
    return values?.map((value) => ProximityTag[value as keyof typeof ProximityTag]) ?? [];
  }

  private toSpecialFeatures(values: string[] | undefined) {
    return values?.map((value) => SpecialFeature[value as keyof typeof SpecialFeature]) ?? [];
  }

  private optionalAvailabilityCreate(
    availability: ListingAvailabilityDto[] | undefined
  ) {
    if (!availability || availability.length === 0) {
      return {};
    }

    return {
      availability: {
        create: this.toAvailabilityCreate(availability)
      }
    };
  }

  private toAvailabilityCreate(
    availability: Array<ListingAvailabilityDto | UpdateListingAvailabilityDto>
  ) {
    return availability.map((window) => {
      const startDate = this.parseDate(window.startDate);
      const endDate = this.parseDate(window.endDate);

      if (endDate <= startDate) {
        throw this.validationException("Availability endDate must be after startDate.");
      }

      return {
        startDate,
        endDate,
        status: AvailabilityStatus.available
      };
    });
  }

  private async optionalPlacesCreate(
    neighborhoodPerks: string[] | undefined,
    localRecommendations: string[] | undefined,
    city: string | undefined
  ) {
    const create = [
      ...(await this.toPlaceCreate(
        ListingPlaceType.neighborhood_perk,
        neighborhoodPerks,
        city
      )),
      ...(await this.toPlaceCreate(
        ListingPlaceType.local_recommendation,
        localRecommendations,
        city
      ))
    ];

    return create.length > 0
      ? {
          places: {
            create
          }
        }
      : {};
  }

  private async toPlacesUpdate(
    neighborhoodPerks: string[] | undefined,
    localRecommendations: string[] | undefined,
    city: string | undefined
  ) {
    if (neighborhoodPerks === undefined && localRecommendations === undefined) {
      return undefined;
    }

    const deleteMany = [];
    const create = [];

    if (neighborhoodPerks !== undefined) {
      deleteMany.push({ type: ListingPlaceType.neighborhood_perk });
      create.push(
        ...(await this.toPlaceCreate(
          ListingPlaceType.neighborhood_perk,
          neighborhoodPerks,
          city
        ))
      );
    }

    if (localRecommendations !== undefined) {
      deleteMany.push({ type: ListingPlaceType.local_recommendation });
      create.push(
        ...(await this.toPlaceCreate(
          ListingPlaceType.local_recommendation,
          localRecommendations,
          city
        ))
      );
    }

    return {
      deleteMany,
      create
    };
  }

  private async toPlaceCreate(
    type: ListingPlaceType,
    labels: string[] | undefined,
    city: string | undefined
  ) {
    const places = await Promise.all(
      labels
        ?.map((label) => label.trim())
        .filter((label) => label.length > 0)
        .map((label) => this.resolvePlace(label, city)) ?? []
    );

    return places.map((place, displayOrder) => ({
      type,
      label: place.label,
      googlePlaceId: place.googlePlaceId,
      mapsUrl: place.mapsUrl,
      displayOrder
    }));
  }

  private async resolvePlace(
    label: string,
    city: string | undefined
  ): Promise<ResolvedPlace> {
    if (this.mapsService) {
      return this.mapsService.resolvePlace(label, city);
    }

    return {
      label,
      googlePlaceId: null,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        city ? `${label}, ${city}` : label
      )}`
    };
  }

  private async verifyLocation(address: string, city: string, placeId?: string) {
    if (this.locationService) {
      return this.locationService.verifyInput(address, city, placeId);
    }
    const normalizedAddress = `${address.trim()}, ${city.trim()}`;
    const legacy = await this.mapsService?.geocodeAddress(normalizedAddress);
    if (legacy && "latitude" in legacy && "longitude" in legacy &&
      typeof legacy.latitude === "number" && typeof legacy.longitude === "number") {
      return {
        status: "verified" as const,
        normalizedAddress,
        fingerprint: addressFingerprint(normalizedAddress),
        formattedAddress: address.trim(),
        providerPlaceId: placeId ?? "legacy-test",
        latitude: legacy.latitude,
        longitude: legacy.longitude,
        precision: "unknown" as const
      };
    }
    return { status: "failed" as const, normalizedAddress,
      fingerprint: addressFingerprint(normalizedAddress), failureCategory: "disabled" };
  }

  private publicCoordinates(listingId: string, verification: LocationVerification) {
    if (verification.status !== "verified") return { latitude: null, longitude: null };
    const secret = this.config
      ? this.config.get<string>("MAPS_LOCATION_PRIVACY_SECRET")
      : "unit-test-only-location-privacy-secret";
    if (!secret) return { latitude: null, longitude: null };
    return stableApproximateCoordinates({
      listingId,
      fingerprint: verification.fingerprint,
      secret,
      latitude: verification.latitude,
      longitude: verification.longitude
    });
  }

  private locationCreateData(
    verification: LocationVerification,
    inputPlaceId: string | undefined,
    inputCity: string
  ) {
    const common = {
      inputAddress: verification.normalizedAddress,
      inputCity,
      inputPlaceId: inputPlaceId ?? null,
      addressFingerprint: verification.fingerprint,
      geocodeAttempts: 1
    };
    if (verification.status !== "verified") {
      return {
        ...common,
        geocodeStatus: verification.status === "ambiguous"
          ? LocationGeocodeStatus.ambiguous : LocationGeocodeStatus.failed,
        failureCategory: verification.failureCategory,
        enrichmentStatus: LocationEnrichmentStatus.not_started
      };
    }
    return {
      ...common,
      verifiedFingerprint: verification.fingerprint,
      formattedAddress: verification.formattedAddress,
      providerPlaceId: verification.providerPlaceId,
      exactLatitude: verification.latitude,
      exactLongitude: verification.longitude,
      geocodeStatus: LocationGeocodeStatus.verified,
      precision: verification.precision,
      provider: "google",
      verifiedAddressVersion: 1,
      geocodedAt: new Date(),
      geocodeExpiresAt: this.providerCoordinateExpiry(),
      enrichmentStatus: LocationEnrichmentStatus.pending
    };
  }

  private providerCoordinateExpiry() {
    return new Date(Date.now() + 30 * 24 * 3_600_000);
  }

  private async enqueueEnrichment(
    transaction: Prisma.TransactionClient,
    listingId: string,
    addressVersion: number
  ) {
    if (!this.jobs) return;
    await this.jobs.enqueue(
      ENRICH_LISTING_LOCATION_JOB,
      { listingId, addressVersion },
      {
        aggregateId: listingId,
        aggregateType: "listing-location",
        client: transaction,
        deduplicationKey: `${ENRICH_LISTING_LOCATION_JOB}:${listingId}:${addressVersion}`,
        maxAttempts: 5
      }
    );
  }

  private async assertLocationChangeAllowed(listingId: string) {
    if (!this.prisma.booking) return;
    const conflict = await this.prisma.booking.findFirst({
      where: {
        listingId,
        status: { in: [
          "accepted",
          "payment_pending",
          "paid"
        ] },
        endDate: { gt: new Date() }
      },
      select: { id: true }
    });
    if (conflict) {
      throw new BadRequestException({
        code: "LISTING_LOCATION_CHANGE_BLOCKED",
        message: "The listing location cannot change while an active reservation exists.",
        details: {}
      });
    }
  }

  private assertNoClientCoordinates(input: object) {
    // HTTP DTO validation rejects these fields. Direct service callers are also safe:
    // supplied values are deliberately ignored and never reach persistence.
    void input;
  }

  private async legacyUpdateListingLocation(
    listing: ListingWithRelations,
    input: UpdateListingDto
  ) {
    const city = this.requiredString(input.city ?? listing.city, "city");
    const address = this.requiredString(input.address ?? listing.address ?? "", "address");
    const geocode = await this.mapsService?.geocodeAddress(`${address}, ${city}`);
    const coordinates = geocode && "latitude" in geocode && "longitude" in geocode &&
      typeof geocode.latitude === "number" && typeof geocode.longitude === "number"
      ? { latitude: geocode.latitude, longitude: geocode.longitude }
      : { latitude: null, longitude: null };
    const approximate = coordinates.latitude === null || coordinates.longitude === null
      ? { latitude: null, longitude: null }
      : stableApproximateCoordinates({
          listingId: listing.id,
          fingerprint: addressFingerprint(`${address}, ${city}`),
          secret: "unit-test-only-location-privacy-secret",
          latitude: coordinates.latitude,
          longitude: coordinates.longitude
        });
    const regularData = await this.toListingUpdateData(
      { ...input, address: undefined, city: undefined, placeId: undefined }, listing);
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${listing.id}, 0))`
      );
      return transaction.listing.update({
        where: { id: listing.id },
        data: {
          ...regularData,
          city,
          address,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          publicLatitude: approximate.latitude,
          publicLongitude: approximate.longitude,
          publicRadiusMeters: PUBLIC_LOCATION_RADIUS_METERS
        },
        include: listingInclude
      });
    });
    return this.toListingDetailDto(updated, true);
  }

  private assertControlledStoragePath(storagePath: string, listingId: string) {
    const expectedPrefix = `listings/${listingId}/`;

    if (
      storagePath.startsWith("http://") ||
      storagePath.startsWith("https://") ||
      storagePath.includes("..") ||
      storagePath.includes("\\") ||
      !storagePath.startsWith(expectedPrefix) ||
      storagePath.length <= expectedPrefix.length ||
      !/^[A-Za-z0-9._/-]+$/.test(storagePath)
    ) {
      throw this.validationException(
        "Listing photos must use a backend-generated storage path."
      );
    }
  }

  private async resolvePhotoDisplayOrder(
    transaction: Prisma.TransactionClient,
    listingId: string,
    requestedOrder: number | undefined
  ) {
    if (requestedOrder !== undefined) {
      const existingPhoto = await transaction.listingPhoto.findFirst({
        where: {
          listingId,
          displayOrder: requestedOrder
        },
        select: {
          id: true
        }
      });

      if (existingPhoto) {
        throw this.validationException(
          "A listing photo already uses this display order."
        );
      }

      return requestedOrder;
    }

    const result = await transaction.listingPhoto.aggregate({
      where: { listingId },
      _max: { displayOrder: true }
    });

    return (result._max.displayOrder ?? -1) + 1;
  }

  private toStorageFileUrl(storagePath: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "listing-photos";
    const encodedPath = storagePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

    return supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`
      : storagePath;
  }

  private toListingSummaryDto(
    listing: ListingWithRelations,
    canViewExactLocation: boolean
  ) {
    const coverPhoto = listing.photos[0];

    return {
      id: listing.id,
      title: listing.title,
      city: listing.city,
      priceCents: listing.priceCents,
      currency: listing.currency,
      priceUnit: listing.priceUnit,
      status: listing.status,
      publicLocation: this.toPublicLocationDto(listing),
      exactLocation: canViewExactLocation
        ? this.toExactLocationDto(listing)
        : null,
      coverPhotoUrl: coverPhoto?.fileUrl ?? null,
      stayDurations: [...listing.stayDurations],
      host: {
        id: listing.host.id,
        firstName: listing.host.firstName,
        displayName: listing.host.displayName
      }
    };
  }

  private toListingDetailDto(
    listing: ListingWithRelations,
    canViewExactLocation: boolean
  ) {
    return {
      ...this.toListingSummaryDto(listing, canViewExactLocation),
      description: listing.description,
      currency: listing.currency,
      listingType: listing.listingType,
      category: listing.category,
      proximityTags: [...listing.proximityTags],
      specialFeatures: [...listing.specialFeatures],
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
      timeZone: listing.timeZone,
      photos: listing.photos.map((photo) => ({
        id: photo.id,
        fileUrl: photo.fileUrl,
        displayOrder: photo.displayOrder,
        source: photo.legacyUnprocessed ? "legacy" : "processed"
      })),
      ...(canViewExactLocation
        ? {
            checkoutTime: listing.checkoutTime,
            availability: listing.availability.map((window) => ({
              id: window.id,
              startDate: formatCivilDate(window.startDate),
              endDate: formatCivilDate(window.endDate),
              status: window.status
            }))
          }
        : {}),
      locationStatus: {
        geocode: listing.location?.geocodeStatus ?? LocationGeocodeStatus.not_started,
        enrichment: listing.location?.enrichmentStatus ?? LocationEnrichmentStatus.not_started,
        addressVersion: canViewExactLocation ? listing.location?.addressVersion ?? null : undefined,
        failureCategory: canViewExactLocation ? listing.location?.failureCategory ?? null : undefined
      },
      nearbyPlaces: this.toNearbyPlacesDto(listing),
      places: listing.places
        .filter(
          (place) =>
            canViewExactLocation || !this.isUnsafePublicPlace(place, listing)
        )
        .map((place) => ({
          id: place.id,
          type: place.type,
          label: place.label,
          googlePlaceId: place.googlePlaceId,
          mapsUrl: this.toSafePlaceMapsUrl(
            place.label,
            listing.city,
            place.googlePlaceId
          ),
          displayOrder: place.displayOrder
        })),
      host: listing.host
    };
  }

  private toNearbyPlacesDto(listing: ListingWithRelations) {
    const rounding = this.config?.get<number>("MAPS_PUBLIC_DISTANCE_ROUNDING_METERS") ?? 100;
    const version = listing.location?.verifiedAddressVersion;
    const now = Date.now();
    return (listing.nearbyPlaces ?? [])
      .filter((place) => place.addressVersion === version && place.expiresAt.getTime() > now)
      .map((place) => ({
        category: place.category,
        name: place.displayName,
        mapsUrl: place.mapsUrl,
        approximateDistanceMeters: roundPublicDistance(place.straightLineDistanceMeters, rounding),
        routeDistanceMeters: roundPublicDistance(place.routeDistanceMeters, rounding),
        routeDurationSeconds: place.routeDurationSeconds,
        travelMode: place.routeMode,
        dataUpdatedAt: place.fetchedAt.toISOString()
      }));
  }

  private toPublicLocationDto(
    listing: ListingWithRelations
  ): PublicListingLocationDto {
    return {
      city: listing.city,
      latitude: this.optionalNumber(listing.publicLatitude),
      longitude: this.optionalNumber(listing.publicLongitude),
      radiusMeters: listing.publicRadiusMeters,
      precision: "approximate"
    };
  }

  private toExactLocationDto(
    listing: ListingWithRelations
  ): ExactListingLocationDto | null {
    if (!listing.address) {
      return null;
    }

    return {
      address: listing.address,
      latitude: this.optionalNumber(listing.latitude),
      longitude: this.optionalNumber(listing.longitude)
    };
  }

  private isUnsafePublicPlace(
    place: ListingWithRelations["places"][number],
    listing: ListingWithRelations
  ) {
    const normalizedAddress = this.normalizeLocationText(listing.address);
    const normalizedLabel = this.normalizeLocationText(place.label);
    if (
      normalizedAddress &&
      normalizedLabel &&
      (normalizedLabel.includes(normalizedAddress) ||
        (normalizedLabel.length >= 6 &&
          /\d/.test(normalizedLabel) &&
          normalizedAddress.includes(normalizedLabel)))
    ) {
      return true;
    }

    return false;
  }

  private toSafePlaceMapsUrl(
    label: string,
    city: string,
    googlePlaceId: string | null
  ) {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", `${label}, ${city}`);
    if (googlePlaceId) {
      url.searchParams.set("query_place_id", googlePlaceId);
    }

    return url.toString();
  }

  private normalizeLocationText(value: string | null) {
    return value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  }

  private optionalNumber(value: Prisma.Decimal | null) {
    return value === null ? null : Number(value);
  }

  private priceToCents(price: number) {
    return Math.round(price * 100);
  }

  private parseDate(value: string) {
    try {
      return parseCivilDate(value);
    } catch {
      throw this.validationException(
        "Date values must use a real YYYY-MM-DD civil date."
      );
    }
  }

  private validationException(message: string) {
    return new BadRequestException({
      code: "VALIDATION_ERROR",
      message,
      details: {}
    });
  }

  private notFoundException() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Listing was not found.",
      details: {}
    });
  }
}
