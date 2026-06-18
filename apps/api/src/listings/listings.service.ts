import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AvailabilityStatus,
  ListingPlaceType,
  ListingStatus,
  ListingType,
  PriceUnit,
  Prisma,
  ProximityTag,
  SpecialFeature,
  StayDuration,
  UserRole,
  type User
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import type { AddListingPhotoDto } from "./dto/add-listing-photo.dto";
import type {
  CreateListingDto,
  ListingAvailabilityDto
} from "./dto/create-listing.dto";
import type { SearchListingsQueryDto } from "./dto/search-listings-query.dto";
import type {
  UpdateListingAvailabilityDto,
  UpdateListingDto
} from "./dto/update-listing.dto";

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
    orderBy: { displayOrder: "asc" as const }
  },
  availability: {
    orderBy: { startDate: "asc" as const }
  },
  places: {
    orderBy: { displayOrder: "asc" as const }
  }
} satisfies Prisma.ListingInclude;

type ListingWithRelations = Prisma.ListingGetPayload<{
  include: typeof listingInclude;
}>;

type ApiUserRole = "renter" | "host" | "admin";

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  async searchListings(query: SearchListingsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.toSearchWhere(query);
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
      data: listings.map((listing) => this.toListingSummaryDto(listing)),
      meta: {
        page,
        limit,
        total
      },
      error: null
    };
  }

  async getListing(id: string) {
    const listing = await this.prisma.listing.findFirst({
      where: {
        id,
        status: ListingStatus.approved,
        deletedAt: null
      },
      include: listingInclude
    });

    if (!listing) {
      throw this.notFoundException();
    }

    return this.toListingDetailDto(listing);
  }

  async createListing(token: string, input: CreateListingDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertHost(currentUser);

    return this.prisma.listing.create({
      data: {
        hostId: currentUser.id,
        title: this.requiredString(input.title, "title"),
        description: this.requiredString(input.description, "description"),
        city: this.requiredString(input.city, "city"),
        address: this.optionalString(input.address),
        latitude: input.latitude,
        longitude: input.longitude,
        priceCents: input.priceCents,
        priceUnit: PriceUnit[input.priceUnit],
        listingType: ListingType[input.listingType],
        category: this.optionalString(input.category),
        status: ListingStatus.pending,
        stayDurations: this.toStayDurations(input.stayDurations),
        proximityTags: this.toProximityTags(input.proximityTags),
        specialFeatures: this.toSpecialFeatures(input.specialFeatures),
        ...this.optionalAvailabilityCreate(input.availability),
        ...this.optionalPlacesCreate(
          input.neighborhoodPerks,
          input.localRecommendations
        )
      },
      select: {
        id: true,
        status: true
      }
    });
  }

  async updateListing(token: string, id: string, input: UpdateListingDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const listing = await this.findEditableListing(id);
    this.assertHostOwnerOrAdmin(currentUser, listing.hostId);
    const data = this.toListingUpdateData(input);

    if (Object.keys(data).length === 0) {
      return this.toListingDetailDto(listing);
    }

    const updatedListing = await this.prisma.listing.update({
      where: { id },
      data,
      include: listingInclude
    });

    return this.toListingDetailDto(updatedListing);
  }

  async deleteListing(token: string, id: string) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const listing = await this.findEditableListing(id);
    this.assertHostOwnerOrAdmin(currentUser, listing.hostId);

    const archivedListing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: ListingStatus.archived,
        deletedAt: new Date()
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
  }

  async addListingPhoto(
    token: string,
    id: string,
    input: AddListingPhotoDto
  ) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const listing = await this.findEditableListing(id);
    this.assertHostOwnerOrAdmin(currentUser, listing.hostId);
    this.assertControlledStoragePath(input.storagePath, id);

    return this.prisma.listingPhoto.create({
      data: {
        listingId: id,
        storagePath: input.storagePath,
        fileUrl: this.toStorageFileUrl(input.storagePath),
        displayOrder: input.displayOrder ?? 0
      },
      select: {
        id: true,
        storagePath: true,
        fileUrl: true,
        displayOrder: true
      }
    });
  }

  private toSearchWhere(query: SearchListingsQueryDto): Prisma.ListingWhereInput {
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
          { address: { contains: query.location, mode: "insensitive" } },
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

    const availabilityFilter = this.toAvailabilityFilter(
      query.startDate,
      query.endDate
    );
    if (availabilityFilter) {
      where.availability = availabilityFilter;
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

  private toAvailabilityFilter(startDate?: string, endDate?: string) {
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

    return {
      some: {
        status: AvailabilityStatus.available,
        startDate: { lte: start },
        endDate: { gte: end }
      }
    };
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
      latitude: {
        gte: south,
        lte: north
      },
      longitude: {
        gte: west,
        lte: east
      }
    };
  }

  private toListingUpdateData(input: UpdateListingDto): Prisma.ListingUpdateInput {
    const data: Prisma.ListingUpdateInput = {
      ...this.optionalUpdateString("title", input.title, true),
      ...this.optionalUpdateString("description", input.description, true),
      ...this.optionalUpdateString("city", input.city, true),
      ...this.optionalUpdateString("address", input.address, false),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
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
        : {})
    };

    if (input.availability !== undefined) {
      data.availability = {
        deleteMany: {},
        create: this.toAvailabilityCreate(input.availability)
      };
    }

    const placesUpdate = this.toPlacesUpdate(
      input.neighborhoodPerks,
      input.localRecommendations
    );
    if (placesUpdate) {
      data.places = placesUpdate;
    }

    return data;
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

  private assertHost(user: User) {
    if (!this.hasRole(user, "host") && !this.hasRole(user, "admin")) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only hosts can create listings.",
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

  private optionalPlacesCreate(
    neighborhoodPerks: string[] | undefined,
    localRecommendations: string[] | undefined
  ) {
    const create = [
      ...this.toPlaceCreate(
        ListingPlaceType.neighborhood_perk,
        neighborhoodPerks
      ),
      ...this.toPlaceCreate(
        ListingPlaceType.local_recommendation,
        localRecommendations
      )
    ];

    return create.length > 0
      ? {
          places: {
            create
          }
        }
      : {};
  }

  private toPlacesUpdate(
    neighborhoodPerks: string[] | undefined,
    localRecommendations: string[] | undefined
  ) {
    if (neighborhoodPerks === undefined && localRecommendations === undefined) {
      return undefined;
    }

    const deleteMany = [];
    const create = [];

    if (neighborhoodPerks !== undefined) {
      deleteMany.push({ type: ListingPlaceType.neighborhood_perk });
      create.push(
        ...this.toPlaceCreate(
          ListingPlaceType.neighborhood_perk,
          neighborhoodPerks
        )
      );
    }

    if (localRecommendations !== undefined) {
      deleteMany.push({ type: ListingPlaceType.local_recommendation });
      create.push(
        ...this.toPlaceCreate(
          ListingPlaceType.local_recommendation,
          localRecommendations
        )
      );
    }

    return {
      deleteMany,
      create
    };
  }

  private toPlaceCreate(type: ListingPlaceType, labels: string[] | undefined) {
    return (
      labels
        ?.map((label) => label.trim())
        .filter((label) => label.length > 0)
        .map((label, displayOrder) => ({
          type,
          label,
          displayOrder
        })) ?? []
    );
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

  private toListingSummaryDto(listing: ListingWithRelations) {
    const coverPhoto = listing.photos[0];

    return {
      id: listing.id,
      title: listing.title,
      city: listing.city,
      priceCents: listing.priceCents,
      currency: listing.currency,
      priceUnit: listing.priceUnit,
      status: listing.status,
      coverPhotoUrl: coverPhoto?.fileUrl ?? null,
      stayDurations: [...listing.stayDurations],
      host: {
        id: listing.host.id,
        firstName: listing.host.firstName,
        displayName: listing.host.displayName
      }
    };
  }

  private toListingDetailDto(listing: ListingWithRelations) {
    return {
      ...this.toListingSummaryDto(listing),
      description: listing.description,
      address: listing.address,
      latitude: this.optionalNumber(listing.latitude),
      longitude: this.optionalNumber(listing.longitude),
      currency: listing.currency,
      listingType: listing.listingType,
      category: listing.category,
      proximityTags: [...listing.proximityTags],
      specialFeatures: [...listing.specialFeatures],
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
      photos: listing.photos.map((photo) => ({
        id: photo.id,
        fileUrl: photo.fileUrl,
        storagePath: photo.storagePath,
        displayOrder: photo.displayOrder
      })),
      availability: listing.availability.map((window) => ({
        id: window.id,
        startDate: window.startDate.toISOString(),
        endDate: window.endDate.toISOString(),
        status: window.status
      })),
      places: listing.places.map((place) => ({
        id: place.id,
        type: place.type,
        label: place.label,
        googlePlaceId: place.googlePlaceId,
        mapsUrl: place.mapsUrl,
        displayOrder: place.displayOrder
      })),
      host: listing.host
    };
  }

  private optionalNumber(value: Prisma.Decimal | null) {
    return value === null ? null : Number(value);
  }

  private priceToCents(price: number) {
    return Math.round(price * 100);
  }

  private parseDate(value: string) {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw this.validationException("Invalid date value.");
    }

    return parsed;
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
