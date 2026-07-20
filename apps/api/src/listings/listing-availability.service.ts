import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AvailabilityStatus,
  BookingStatus,
  ListingStatus,
  Prisma,
  UserRole,
  type User
} from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  formatCivilDate,
  isRangeBookable,
  mergeDateRanges,
  parseCivilDate,
  projectUnavailableRanges,
  rangesOverlap,
  type AvailabilityRange,
  type CivilDateRange
} from "./availability-calendar";
import type {
  AvailabilityPageQueryDto,
  CalendarRangeQueryDto,
  CreateAvailabilityWindowDto,
  UpdateAvailabilityWindowDto
} from "./dto/availability.dto";

const RESERVING_STATUSES = [
  BookingStatus.requested,
  BookingStatus.accepted,
  BookingStatus.payment_pending,
  BookingStatus.paid
] as const;

@Injectable()
export class ListingAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService
  ) {}

  async listWindows(
    token: string,
    listingId: string,
    query: AvailabilityPageQueryDto
  ) {
    const user = await this.auth.getCurrentUserRecord(token);
    await this.authorizedListing(this.prisma, user, listingId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const [total, windows] = await Promise.all([
      this.prisma.listingAvailability.count({ where: { listingId } }),
      this.prisma.listingAvailability.findMany({
        where: { listingId },
        orderBy: [{ startDate: "asc" }, { endDate: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);
    return {
      data: windows.map((window) => this.windowDto(window)),
      meta: { page, limit, total }
    };
  }

  async createWindow(
    token: string,
    listingId: string,
    input: CreateAvailabilityWindowDto
  ) {
    const user = await this.auth.getCurrentUserRecord(token);
    const proposed = this.inputRange(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockListing(transaction, listingId);
      await this.authorizedListing(transaction, user, listingId);
      const state = await this.loadCalendarState(transaction, listingId);
      await this.assertReservationsProtected(
        [...state.windows, proposed],
        state.reservations
      );
      return this.windowDto(
        await transaction.listingAvailability.create({
          data: { listingId, ...proposed }
        })
      );
    });
  }

  async updateWindow(
    token: string,
    listingId: string,
    windowId: string,
    input: UpdateAvailabilityWindowDto
  ) {
    const user = await this.auth.getCurrentUserRecord(token);
    if (
      input.startDate === undefined &&
      input.endDate === undefined &&
      input.status === undefined
    ) {
      throw this.invalidRange("At least one availability field is required.");
    }
    return this.prisma.$transaction(async (transaction) => {
      await this.lockListing(transaction, listingId);
      await this.authorizedListing(transaction, user, listingId);
      const current = await transaction.listingAvailability.findFirst({
        where: { id: windowId, listingId }
      });
      if (!current) throw this.notFound();
      const proposed = this.inputRange({
        startDate: input.startDate ?? formatCivilDate(current.startDate),
        endDate: input.endDate ?? formatCivilDate(current.endDate),
        status: input.status ?? current.status
      });
      const state = await this.loadCalendarState(transaction, listingId);
      await this.assertReservationsProtected(
        state.windows.map((window) =>
          window.id === windowId ? { ...window, ...proposed } : window
        ),
        state.reservations
      );
      return this.windowDto(
        await transaction.listingAvailability.update({
          where: { id: windowId },
          data: proposed
        })
      );
    });
  }

  async deleteWindow(token: string, listingId: string, windowId: string) {
    const user = await this.auth.getCurrentUserRecord(token);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockListing(transaction, listingId);
      await this.authorizedListing(transaction, user, listingId);
      const current = await transaction.listingAvailability.findFirst({
        where: { id: windowId, listingId }
      });
      if (!current) throw this.notFound();
      const state = await this.loadCalendarState(transaction, listingId);
      await this.assertReservationsProtected(
        state.windows.filter((window) => window.id !== windowId),
        state.reservations
      );
      await transaction.listingAvailability.delete({ where: { id: windowId } });
      return { id: windowId, deleted: true };
    });
  }

  async getHostCalendar(
    token: string,
    listingId: string,
    query: CalendarRangeQueryDto
  ) {
    const user = await this.auth.getCurrentUserRecord(token);
    const requested = this.queryRange(query);
    const listing = await this.authorizedListing(this.prisma, user, listingId);
    const state = await this.loadCalendarState(this.prisma, listingId, requested);
    return {
      listingId,
      timeZone: listing.timeZone,
      range: this.rangeDto(requested),
      windows: state.windows.map((window) => this.windowDto(window)),
      reservations: mergeDateRanges(state.reservations).map((reservation) => ({
        ...this.rangeDto(reservation),
        status: "reserved" as const
      }))
    };
  }

  async getPublicCalendar(listingId: string, query: CalendarRangeQueryDto) {
    const requested = this.queryRange(query);
    const listing = await this.prisma.listing.findFirst({
      where: {
        id: listingId,
        status: ListingStatus.approved,
        deletedAt: null
      },
      select: { id: true, timeZone: true }
    });
    if (!listing) throw this.notFound();
    const state = await this.loadCalendarState(this.prisma, listingId, requested);
    return {
      timeZone: listing.timeZone,
      range: this.rangeDto(requested),
      unavailable: projectUnavailableRanges(
        requested,
        state.windows,
        state.reservations
      ).map((range) => this.rangeDto(range))
    };
  }

  private async authorizedListing(
    client: PrismaService | Prisma.TransactionClient,
    user: User,
    listingId: string
  ) {
    const listing = await client.listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: { id: true, hostId: true, timeZone: true }
    });
    if (
      !listing ||
      (!user.roles.includes(UserRole.admin) &&
        !(user.roles.includes(UserRole.host) && listing.hostId === user.id))
    ) {
      throw this.notFound();
    }
    return listing;
  }

  private async loadCalendarState(
    client: PrismaService | Prisma.TransactionClient,
    listingId: string,
    bounds?: CivilDateRange
  ) {
    const overlap = bounds
      ? { startDate: { lt: bounds.endDate }, endDate: { gt: bounds.startDate } }
      : {};
    const [windows, reservations] = await Promise.all([
      client.listingAvailability.findMany({
        where: { listingId, ...overlap },
        orderBy: [{ startDate: "asc" }, { endDate: "asc" }]
      }),
      client.booking.findMany({
        where: {
          listingId,
          status: { in: [...RESERVING_STATUSES] },
          ...overlap
        },
        select: { startDate: true, endDate: true },
        orderBy: [{ startDate: "asc" }, { endDate: "asc" }]
      })
    ]);
    return { windows, reservations };
  }

  private async assertReservationsProtected(
    windows: AvailabilityRange[],
    reservations: CivilDateRange[]
  ) {
    const conflict = reservations.find(
      (reservation) =>
        windows.some(
          (window) =>
            window.status === AvailabilityStatus.blocked &&
            rangesOverlap(reservation, window)
        ) || !isRangeBookable(reservation, windows)
    );
    if (conflict) {
      throw new ConflictException({
        code: "AVAILABILITY_CONFLICTS_WITH_RESERVATION",
        message: "The calendar change conflicts with a protected reservation.",
        details: this.rangeDto(conflict)
      });
    }
  }

  private inputRange(input: {
    startDate: string;
    endDate: string;
    status: string;
  }): AvailabilityRange {
    const startDate = this.safeParseDate(input.startDate);
    const endDate = this.safeParseDate(input.endDate);
    if (endDate <= startDate) {
      throw this.invalidRange("Availability endDate must be after startDate.");
    }
    if (input.status !== "available" && input.status !== "blocked") {
      throw this.invalidRange("Availability status is invalid.");
    }
    return {
      startDate,
      endDate,
      status: AvailabilityStatus[input.status]
    };
  }

  private queryRange(query: CalendarRangeQueryDto) {
    const startDate = this.safeParseDate(query.startDate);
    const endDate = this.safeParseDate(query.endDate);
    if (endDate <= startDate) {
      throw this.invalidRange("Calendar endDate must be after startDate.");
    }
    const days = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (days > 366) {
      throw new BadRequestException({
        code: "CALENDAR_RANGE_TOO_LARGE",
        message: "Calendar ranges may cover at most 366 days.",
        details: {}
      });
    }
    return { startDate, endDate };
  }

  private safeParseDate(value: string) {
    try {
      return parseCivilDate(value);
    } catch {
      throw this.invalidRange("Dates must use a real YYYY-MM-DD civil date.");
    }
  }

  private windowDto(window: {
    id: string;
    startDate: Date;
    endDate: Date;
    status: AvailabilityStatus;
  }) {
    return {
      id: window.id,
      ...this.rangeDto(window),
      status: window.status
    };
  }

  private rangeDto(range: CivilDateRange) {
    return {
      startDate: formatCivilDate(range.startDate),
      endDate: formatCivilDate(range.endDate)
    };
  }

  private lockListing(transaction: Prisma.TransactionClient, listingId: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${listingId}, 0))`
    );
  }

  private invalidRange(message: string) {
    return new BadRequestException({
      code: "AVAILABILITY_RANGE_INVALID",
      message,
      details: {}
    });
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Listing not found.",
      details: {}
    });
  }
}
