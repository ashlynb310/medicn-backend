import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AvailabilityStatus,
  BookingStatus,
  ListingStatus,
  PaymentStatus,
  PriceUnit,
  Prisma,
  UserRole,
  type Booking,
  type BookingCancellationOperation,
  type User
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { EmailService } from "../email/email.service";
import { IdentityEligibilityService } from "../identity/identity-eligibility.service";
import { PaymentTransitionService } from "../payments/payment-transition.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  formatCivilDate,
  isRangeBookable,
  parseCivilDate
} from "../listings/availability-calendar";
import type { CreateBookingDto } from "./dto/create-booking.dto";
import type { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";
import type { CheckInLocationDto } from "./dto/booking-location.dto";
import { ListBookingsQueryDto } from "./dto/list-bookings-query.dto";

type BookingWithRelations = Booking & {
  listing: {
    id: string;
    title: string;
    priceUnit: PriceUnit;
    address: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    host: {
      id: string;
      email: string;
      firstName: string | null;
      displayName: string | null;
    };
  };
  renter: {
    id: string;
    email: string;
    firstName: string | null;
    displayName: string | null;
  };
  payments: Array<{
    status: PaymentStatus;
    attemptNumber?: number;
    amountCents?: number;
    amountRefundedCents?: number;
  }>;
  locationSnapshot?: {
    formattedAddress: string;
    exactLatitude: Prisma.Decimal | null;
    exactLongitude: Prisma.Decimal | null;
    sourceListingLocationVersion: number | null;
    capturedAt: Date;
  } | null;
  cancellationOperations?: Array<
    Pick<
      BookingCancellationOperation,
      | "id"
      | "actorType"
      | "reason"
      | "status"
      | "financialDisposition"
      | "requestedAt"
      | "effectiveAt"
      | "active"
    >
  >;
};

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly transitions: PaymentTransitionService,
    private readonly identityEligibility: IdentityEligibilityService
  ) {}

  async createBooking(token: string, input: CreateBookingDto) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    this.assertRenter(currentUser);
    this.assertEmailVerified(currentUser);

    const startDate = this.parseDate(input.startDate);
    const endDate = this.parseDate(input.endDate);
    if (endDate <= startDate) {
      throw this.validationException("Booking endDate must be after startDate.");
    }
    if ((endDate.getTime() - startDate.getTime()) / 86_400_000 > 366) {
      throw new BadRequestException({
        code: "BOOKING_DATE_RANGE_TOO_LARGE",
        message: "Booking date ranges may cover at most 366 days.",
        details: {}
      });
    }

    const booking = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`identity-user:${currentUser.id}`}, 0))`
      );
      await this.identityEligibility.assertApproved(currentUser.id, transaction);
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.listingId}, 0))`
      );

      const listing = await transaction.listing.findFirst({
        where: {
          id: input.listingId,
          status: ListingStatus.approved,
          deletedAt: null
        },
        include: {
          host: {
            select: {
              id: true,
              email: true,
              firstName: true,
              displayName: true
            }
          },
          availability: true
          ,location: {
            select: {
              geocodeStatus: true,
              addressVersion: true,
              verifiedAddressVersion: true
            }
          }
        }
      });

      if (!listing) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Listing was not found.",
          details: {}
        });
      }

      if (listing.hostId === currentUser.id) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: "Hosts cannot book their own listing.",
          details: {}
        });
      }

      if (
        listing.location !== undefined &&
        (listing.location?.geocodeStatus !== "verified" ||
        listing.location.verifiedAddressVersion !== listing.location.addressVersion)
      ) {
        throw new BadRequestException({
          code: "LISTING_LOCATION_NOT_READY",
          message: "This listing location is not currently verified.",
          details: {}
        });
      }

      this.assertListingAvailability(listing.availability, startDate, endDate);
      await this.assertNoConflictingBooking(
        transaction,
        listing.id,
        startDate,
        endDate
      );
      const totalAmountCents = this.calculateTotalAmountCents(
        listing.priceCents,
        listing.priceUnit,
        startDate,
        endDate
      );

      const booking = await transaction.booking.create({
        data: {
          listingId: listing.id,
          renterId: currentUser.id,
          hostId: listing.hostId,
          startDate,
          endDate,
          timeZone: listing.timeZone,
          checkoutTime: listing.checkoutTime,
          selectedOption: this.requiredString(input.selectedOption, "selectedOption"),
          additionalRequests: this.optionalString(input.additionalRequests),
          status: BookingStatus.requested,
          totalAmountCents,
          currency: listing.currency
        },
        include: this.bookingInclude()
      });

      await this.emailService.queueTransactionalEmail(
        {
          to: listing.host.email,
          template: "booking_requested_host",
          subject: `New booking request for ${listing.title}`,
          text: `${currentUser.email} requested ${listing.title} from ${formatCivilDate(startDate)} to ${formatCivilDate(endDate)}.`,
          metadata: {
            bookingId: booking.id,
            listingId: listing.id
          }
        },
        {
          aggregateId: booking.id,
          aggregateType: "booking",
          client: transaction,
          deduplicationKey: `booking-requested:${booking.id}:host`
        }
      );

      return booking;
    });

    return this.toBookingDto(booking, currentUser);
  }

  async listBookings(
    token: string,
    query: ListBookingsQueryDto = new ListBookingsQueryDto()
  ) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BookingWhereInput = {
      ...(this.hasRole(currentUser, "admin")
        ? {}
        : {
            OR: [{ renterId: currentUser.id }, { hostId: currentUser.id }]
          }),
      ...(query.status ? { status: query.status } : {})
    };
    const [bookings, count] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: this.bookingInclude(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      }),
      this.prisma.booking.count({ where })
    ]);
    const total = Math.max(count, bookings.length);

    return {
      data: bookings.map((booking) => this.toBookingDto(booking, currentUser)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      error: null
    };
  }

  async getBooking(token: string, id: string) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const booking = await this.prisma.$transaction(
      (transaction) => transaction.booking.findUnique({
        where: { id },
        include: this.bookingInclude()
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );

    if (!booking) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Booking was not found.",
        details: {}
      });
    }

    this.assertBookingAccess(currentUser, booking);
    return this.toBookingDto(booking, currentUser, true);
  }

  async decideBooking(
    token: string,
    id: string,
    input: UpdateBookingStatusDto
  ) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const existingBooking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.bookingInclude()
    });

    if (!existingBooking) {
      throw this.notFoundException();
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${existingBooking.listingId}, 0))`
      );
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${id}`}, 0))`
      );
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${id}`}, 0))`
      );
      const lockedBooking = await transaction.booking.findUnique({
        where: { id },
        include: this.bookingInclude()
      });
      if (!lockedBooking) throw this.notFoundException();
      this.assertBookingDecisionAccess(currentUser, lockedBooking);
      if (
        !this.transitions.canTransitionBooking(
          lockedBooking.status,
          BookingStatus[input.status]
        )
      ) {
        throw this.bookingStatusNotAllowedException();
      }
      const updated = await transaction.booking.updateMany({
        where: {
          id,
          status: lockedBooking.status
        },
        data: {
          status: BookingStatus[input.status]
        }
      });

      if (updated.count !== 1) {
        throw this.bookingStatusNotAllowedException();
      }

      const booking = await transaction.booking.findUnique({
        where: { id },
        include: this.bookingInclude()
      });

      if (!booking) {
        throw this.notFoundException();
      }

      const accepted = input.status === "accepted";
      await this.emailService.queueTransactionalEmail(
        {
          to: booking.renter.email,
          template: accepted
            ? "booking_accepted_renter"
            : "booking_rejected_renter",
          subject: accepted
            ? `Your booking request for ${booking.listing.title} was accepted`
            : `Your booking request for ${booking.listing.title} was declined`,
          text: accepted
            ? `Your host accepted your booking request for ${booking.listing.title}.`
            : `Your host declined your booking request for ${booking.listing.title}.`,
          metadata: {
            bookingId: booking.id,
            listingId: booking.listingId,
            status: input.status
          }
        },
        {
          aggregateId: booking.id,
          aggregateType: "booking",
          client: transaction,
          deduplicationKey: `booking-${input.status}:${booking.id}:renter`
        }
      );

      return this.toBookingDto(booking, currentUser);
    });
  }

  private bookingInclude() {
    return {
      listing: {
        select: {
          id: true,
          title: true,
          priceUnit: true,
          address: true,
          latitude: true,
          longitude: true,
          host: {
            select: {
              id: true,
              email: true,
              firstName: true,
              displayName: true
            }
          }
        }
      },
      renter: {
        select: {
          id: true,
          email: true,
          firstName: true,
          displayName: true
        }
      },
      payments: {
        select: {
          status: true,
          attemptNumber: true,
          amountCents: true,
          amountRefundedCents: true
        },
        orderBy: { attemptNumber: "desc" as const },
        take: 1
      },
      locationSnapshot: {
        select: {
          formattedAddress: true,
          exactLatitude: true,
          exactLongitude: true,
          sourceListingLocationVersion: true,
          capturedAt: true
        }
      },
      cancellationOperations: {
        select: {
          id: true,
          actorType: true,
          reason: true,
          status: true,
          financialDisposition: true,
          requestedAt: true,
          effectiveAt: true,
          active: true
        },
        orderBy: { version: "desc" as const },
        take: 1
      }
    };
  }

  private assertListingAvailability(
    availability: Array<{
      startDate: Date;
      endDate: Date;
      status: AvailabilityStatus;
    }>,
    startDate: Date,
    endDate: Date
  ) {
    if (!isRangeBookable({ startDate, endDate }, availability)) {
      throw new BadRequestException({
        code: "BOOKING_NOT_AVAILABLE",
        message: "The listing is not available for the selected dates.",
        details: {}
      });
    }
  }

  private async assertNoConflictingBooking(
    client: Prisma.TransactionClient,
    listingId: string,
    startDate: Date,
    endDate: Date
  ) {
    const conflict = await client.booking.findFirst({
      where: {
        listingId,
        status: {
          in: [
            BookingStatus.requested,
            BookingStatus.accepted,
            BookingStatus.payment_pending,
            BookingStatus.paid
          ]
        },
        startDate: { lt: endDate },
        endDate: { gt: startDate }
      },
      select: { id: true }
    });

    if (conflict) {
      throw new BadRequestException({
        code: "BOOKING_NOT_AVAILABLE",
        message: "The selected dates are already requested or booked.",
        details: {}
      });
    }
  }

  private calculateTotalAmountCents(
    priceCents: number,
    priceUnit: PriceUnit,
    startDate: Date,
    endDate: Date
  ) {
    const days = Math.max(
      1,
      Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000)
    );

    if (priceUnit === PriceUnit.month) {
      return priceCents * Math.ceil(days / 30);
    }

    return priceCents * days;
  }

  private assertBookingAccess(user: User, booking: Booking) {
    if (
      this.hasRole(user, "admin") ||
      booking.renterId === user.id ||
      booking.hostId === user.id
    ) {
      return;
    }

    throw this.notFoundException();
  }

  private assertBookingDecisionAccess(user: User, booking: Booking) {
    if (
      this.hasRole(user, "admin") ||
      (this.hasRole(user, "host") && booking.hostId === user.id)
    ) {
      return;
    }

    if (booking.renterId !== user.id && booking.hostId !== user.id) {
      throw this.notFoundException();
    }

    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Only the booking host can make this decision.",
      details: {}
    });
  }

  private assertRenter(user: User) {
    if (!this.hasRole(user, "renter") && !this.hasRole(user, "admin")) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only renters can request bookings.",
        details: {}
      });
    }
  }

  private assertEmailVerified(user: User) {
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: "EMAIL_NOT_VERIFIED",
        message: "Email verification is required before requesting a booking.",
        details: {}
      });
    }
  }

  private hasRole(user: User, role: "renter" | "host" | "admin") {
    return user.roles.includes(UserRole[role]);
  }

  private requiredString(value: string, field: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw this.validationException(`${field} is required.`);
    }

    return trimmed;
  }

  private optionalString(value: string | undefined) {
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseDate(value: string) {
    try {
      return parseCivilDate(value);
    } catch {
      throw this.validationException(
        "Booking dates must use a real YYYY-MM-DD civil date."
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

  private bookingStatusNotAllowedException() {
    return new BadRequestException({
      code: "BOOKING_STATUS_NOT_ALLOWED",
      message: "Only requested bookings can be accepted or rejected.",
      details: {}
    });
  }

  private notFoundException() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Booking was not found.",
      details: {}
    });
  }

  private toBookingDto(
    booking: BookingWithRelations,
    currentUser: User,
    includeCheckInLocation = false
  ) {
    return {
      id: booking.id,
      listingId: booking.listingId,
      renterId: booking.renterId,
      hostId: booking.hostId,
      status: booking.status,
      startDate: formatCivilDate(booking.startDate),
      endDate: formatCivilDate(booking.endDate),
      timeZone: booking.timeZone,
      checkoutTime: booking.checkoutTime,
      requestExpiresAt: booking.requestExpiresAt.toISOString(),
      expiredAt: booking.expiredAt?.toISOString() ?? null,
      expirySource: booking.expirySource,
      completedAt: booking.completedAt?.toISOString() ?? null,
      completionSource: booking.completionSource,
      selectedOption: booking.selectedOption,
      additionalRequests: booking.additionalRequests,
      totalAmountCents: booking.totalAmountCents,
      currency: booking.currency,
      cancellationReason: booking.cancellationReason,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
      ...(includeCheckInLocation
        ? {
            checkInLocation: this.toCheckInLocationDto(booking, currentUser),
            cancellation: this.toCancellationSummary(booking)
          }
        : {}),
      listing: {
        id: booking.listing.id,
        title: booking.listing.title,
        priceUnit: booking.listing.priceUnit,
        host: booking.listing.host
      },
      renter: booking.renter
    };
  }

  private toCheckInLocationDto(
    booking: BookingWithRelations,
    currentUser: User
  ): CheckInLocationDto | null {
    const isHostOrAdmin =
      this.hasRole(currentUser, "admin") || booking.hostId === currentUser.id;
    const currentPayment = booking.payments[0];
    const cumulativeFullRefund =
      currentPayment?.amountCents !== undefined &&
      currentPayment.amountCents > 0 &&
      currentPayment.amountRefundedCents !== undefined &&
      currentPayment.amountRefundedCents >= currentPayment.amountCents;
    const hasSettledPayment =
      currentPayment?.status === PaymentStatus.paid ||
      currentPayment?.status === PaymentStatus.partially_refunded;
    const hasRevokedPayment =
      currentPayment?.status === PaymentStatus.refunded ||
      currentPayment?.status === PaymentStatus.disputed ||
      cumulativeFullRefund;
    const isCurrentlyFulfillableRenter =
      booking.renterId === currentUser.id &&
      (booking.status === BookingStatus.paid ||
        booking.status === BookingStatus.completed) &&
      booking.cancelledAt === null &&
      booking.locationSnapshot != null &&
      booking.cancellationOperations?.[0]?.active !== true &&
      hasSettledPayment &&
      !hasRevokedPayment;

    if (!isHostOrAdmin && !isCurrentlyFulfillableRenter) {
      return null;
    }

    const snapshot = booking.locationSnapshot;
    if (snapshot) {
      return {
        address: snapshot.formattedAddress,
        latitude: snapshot.exactLatitude === null ? null : Number(snapshot.exactLatitude),
        longitude: snapshot.exactLongitude === null ? null : Number(snapshot.exactLongitude),
        sourceListingLocationVersion: snapshot.sourceListingLocationVersion,
        capturedAt: snapshot.capturedAt.toISOString()
      };
    }

    if (!booking.listing.address) return null;

    return {
      address: booking.listing.address,
      latitude:
        booking.listing.latitude === null ? null : Number(booking.listing.latitude),
      longitude:
        booking.listing.longitude === null
          ? null
          : Number(booking.listing.longitude),
      sourceListingLocationVersion: null,
      capturedAt: null
    };
  }

  private toCancellationSummary(booking: BookingWithRelations) {
    const operation = booking.cancellationOperations?.[0];
    if (!operation) return null;
    return {
      id: operation.id,
      actorType: operation.actorType,
      reason: operation.reason,
      status: operation.status,
      financialDisposition: operation.financialDisposition,
      requestedAt: operation.requestedAt.toISOString(),
      effectiveAt: operation.effectiveAt?.toISOString() ?? null
    };
  }
}
