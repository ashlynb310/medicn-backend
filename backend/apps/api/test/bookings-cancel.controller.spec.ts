import { BadRequestException, ValidationPipe } from "@nestjs/common";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsController } from "../src/bookings/bookings.controller";
import { CancelBookingDto } from "../src/bookings/dto/cancel-booking.dto";
import type { BookingsService } from "../src/bookings/bookings.service";
import type { BookingCancellationsService } from "../src/payments/booking-cancellations.service";

describe("BookingsController cancellation boundary", () => {
  const auth = {
    extractBearerToken: jest.fn().mockReturnValue("token")
  } as unknown as AuthService;
  const bookings = {} as BookingsService;
  const cancellations = {
    cancelBooking: jest.fn().mockResolvedValue({ id: "operation_1" })
  };
  const controller = new BookingsController(
    auth,
    bookings,
    cancellations as unknown as BookingCancellationsService
  );

  beforeEach(() => jest.clearAllMocks());

  it("forwards only the authenticated token, booking, bounded key, and reason", async () => {
    await controller.cancelBooking(
      "Bearer access",
      "client-request-1",
      "booking_1",
      { reason: "plans_changed" }
    );

    expect(cancellations.cancelBooking).toHaveBeenCalledWith(
      "token",
      "booking_1",
      "client-request-1",
      { reason: "plans_changed" }
    );
  });

  it.each([undefined, "", " ", "x".repeat(201)])(
    "rejects a missing or invalid Idempotency-Key",
    async (key) => {
      await expect(
        controller.cancelBooking("Bearer access", key, "booking_1", {
          reason: "plans_changed"
        })
      ).rejects.toMatchObject({ response: { code: "VALIDATION_ERROR", details: {} } });
      expect(cancellations.cancelBooking).not.toHaveBeenCalled();
    }
  );

  it("rejects fields outside the cancellation DTO allowlist", async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    });

    await expect(
      pipe.transform(
        { reason: "plans_changed", refundAmount: 100 },
        { type: "body", metatype: CancelBookingDto }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects free-form and system-only reasons at the HTTP boundary", async () => {
    const pipe = new ValidationPipe({ transform: true });

    await expect(
      pipe.transform(
        { reason: "refund everything because support said so" },
        { type: "body", metatype: CancelBookingDto }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { reason: "full_refund" },
        { type: "body", metatype: CancelBookingDto }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
