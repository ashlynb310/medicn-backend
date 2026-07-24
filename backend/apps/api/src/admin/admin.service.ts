import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AdminActionType,
  AdminTargetType,
  LocationGeocodeStatus,
  ListingStatus,
  Prisma,
  UserRole,
  type User
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { IdentityEligibilityService } from "../identity/identity-eligibility.service";
import { PrismaService } from "../prisma/prisma.service";
import type { ListAdminListingsQueryDto } from "./dto/list-admin-listings-query.dto";
import type { ModerateListingDto } from "./dto/moderate-listing.dto";

const adminListingInclude = {
  host: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true
    }
  },
  photos: {
    orderBy: { displayOrder: "asc" as const }
  },
  location: true
} satisfies Prisma.ListingInclude;

type AdminListingWithRelations = Prisma.ListingGetPayload<{
  include: typeof adminListingInclude;
}>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly identityEligibility: IdentityEligibilityService
  ) {}

  async listListings(token: string, query: ListAdminListingsQueryDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertAdmin(currentUser);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? "pending";
    const where: Prisma.ListingWhereInput = {
      status: ListingStatus[status],
      deletedAt: null
    };

    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: adminListingInclude,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      data: listings.map((listing) => this.toListingDto(listing)),
      meta: {
        page,
        limit,
        total
      },
      error: null
    };
  }

  async moderateListing(
    token: string,
    id: string,
    input: ModerateListingDto
  ) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertAdmin(currentUser);

    const listing = await this.prisma.listing.findFirst({
      where: {
        id,
        deletedAt: null
      },
      select: {
        id: true,
        status: true,
        hostId: true,
        location: {
          select: {
            geocodeStatus: true,
            addressVersion: true,
            verifiedAddressVersion: true
          }
        }
      }
    });

    if (!listing) {
      throw this.notFoundException();
    }

    if (listing.status !== ListingStatus.pending) {
      throw this.listingStatusNotAllowedException();
    }

    const nextStatus =
      input.status === "approved"
        ? ListingStatus.approved
        : ListingStatus.rejected;

    return this.prisma.$transaction(async (transaction) => {
      if (nextStatus === ListingStatus.approved) {
        await transaction.$executeRaw(
          Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${listing.hostId} FOR UPDATE`
        );
        const host = await transaction.user.findUnique({
          where: { id: listing.hostId },
          select: { emailVerifiedAt: true }
        });
        if (!host?.emailVerifiedAt) {
          throw new ForbiddenException({
            code: "EMAIL_NOT_VERIFIED",
            message: "The Host must verify their email before listing approval.",
            details: {}
          });
        }
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`identity-user:${listing.hostId}`}, 0))`
        );
        await this.identityEligibility.assertApproved(listing.hostId, transaction);
        if (
          listing.location !== undefined &&
          (listing.location?.geocodeStatus !== LocationGeocodeStatus.verified ||
            listing.location.verifiedAddressVersion !== listing.location.addressVersion)
        ) {
          throw new BadRequestException({
            code: "LISTING_LOCATION_NOT_READY",
            message: "The listing location must be verified before approval.",
            details: {}
          });
        }
      }
      const updated = await transaction.listing.updateMany({
        where: {
          id,
          status: ListingStatus.pending,
          deletedAt: null
        },
        data: {
          status: nextStatus
        }
      });

      if (updated.count !== 1) {
        throw this.listingStatusNotAllowedException();
      }

      await transaction.adminAction.create({
        data: {
          adminId: currentUser.id,
          targetType: AdminTargetType.listing,
          targetId: id,
          action:
            nextStatus === ListingStatus.approved
              ? AdminActionType.approve
              : AdminActionType.reject,
          note: input.note?.trim() || null
        }
      });

      const moderatedListing = await transaction.listing.findUnique({
        where: { id },
        include: adminListingInclude
      });

      if (!moderatedListing) {
        throw this.notFoundException();
      }

      return this.toListingDto(moderatedListing);
    });
  }

  private assertAdmin(user: User) {
    if (user.roles.includes(UserRole.admin)) {
      return;
    }

    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Only administrators can moderate listings.",
      details: {}
    });
  }

  private toListingDto(listing: AdminListingWithRelations) {
    return {
      id: listing.id,
      title: listing.title,
      city: listing.city,
      priceCents: listing.priceCents,
      currency: listing.currency,
      priceUnit: listing.priceUnit,
      status: listing.status,
      locationStatus: listing.location?.geocodeStatus ?? "not_started",
      coverPhotoUrl: listing.photos[0]?.fileUrl ?? null,
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
      host: listing.host
    };
  }

  private listingStatusNotAllowedException() {
    return new BadRequestException({
      code: "LISTING_STATUS_NOT_ALLOWED",
      message: "Only pending listings can be approved or rejected.",
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
