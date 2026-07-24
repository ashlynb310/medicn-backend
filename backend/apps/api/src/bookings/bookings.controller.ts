import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { BookingsService } from "./bookings.service";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";
import { CancelBookingDto } from "./dto/cancel-booking.dto";
import { BookingCancellationsService } from "../payments/booking-cancellations.service";
import { RateLimit } from "../common/http/rate-limit.decorator";
import { ListBookingsQueryDto } from "./dto/list-bookings-query.dto";

@Controller("bookings")
export class BookingsController {
  constructor(
    private readonly authService: AuthService,
    private readonly bookingsService: BookingsService,
    private readonly cancellationsService: BookingCancellationsService
  ) {}

  @Post()
  async createBooking(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateBookingDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.bookingsService.createBooking(token, body);
  }

  @Post(":id/cancel")
  @RateLimit("checkout_or_cancel")
  async cancelBooking(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id") id: string,
    @Body() body: CancelBookingDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    const key = idempotencyKey?.trim();
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid Idempotency-Key header is required.",
        details: {}
      });
    }
    return this.cancellationsService.cancelBooking(token, id, key, body);
  }

  @Get()
  async listBookings(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListBookingsQueryDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.bookingsService.listBookings(token, query);
  }

  @Get(":id")
  async getBooking(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.bookingsService.getBooking(token, id);
  }

  @Patch(":id/status")
  async updateBookingStatus(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: UpdateBookingStatusDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.bookingsService.decideBooking(token, id, body);
  }
}
