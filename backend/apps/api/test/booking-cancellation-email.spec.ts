import type { ConfigService } from "@nestjs/config";
import { EmailService } from "../src/email/email.service";
import type { JobsService } from "../src/jobs/jobs.service";
import type { PrismaService } from "../src/prisma/prisma.service";

describe("booking cancellation email resolution", () => {
  it("resolves the recipient server-side and uses exact no-payment-collected copy", async () => {
    const prisma = {
      bookingCancellationOperation: {
        findFirst: jest.fn().mockResolvedValue({
          booking: { listing: { title: "Safe listing title" } }
        })
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: "trusted@example.com" })
      }
    };
    const service = new EmailService(
      { enqueue: jest.fn() } as unknown as JobsService,
      { get: jest.fn() } as unknown as ConfigService,
      prisma as unknown as PrismaService
    );
    const sendNow = jest.spyOn(service, "sendNow").mockResolvedValue({
      provider: "local",
      messageId: "local-message",
      acceptedAt: new Date(),
      simulated: true
    });

    await service.sendBookingCancellationNow(
      {
        cancellationOperationId: "cancel_1",
        recipientUserId: "host_1",
        template: "booking_cancelled_no_payment"
      },
      { outboxEventId: "outbox_1" }
    );

    expect(sendNow).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "trusted@example.com",
        template: "booking_cancelled_no_payment",
        text: "The booking was cancelled. No payment was collected."
      }),
      { outboxEventId: "outbox_1" }
    );
    expect(JSON.stringify(sendNow.mock.calls[0]?.[0])).not.toMatch(
      /address|coordinate|paymentIntent|refundAmount/
    );
  });

  it("resolves completion recipients from opaque IDs after commit", async () => {
    const prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue({
          listing: { title: "Safe listing title" }
        })
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: "trusted@example.com" })
      }
    };
    const service = new EmailService(
      { enqueue: jest.fn() } as unknown as JobsService,
      { get: jest.fn() } as unknown as ConfigService,
      prisma as unknown as PrismaService
    );
    const sendNow = jest.spyOn(service, "sendNow").mockResolvedValue({
      provider: "local",
      messageId: "local-message",
      acceptedAt: new Date(),
      simulated: true
    });

    await service.sendBookingCompletionNow(
      { bookingId: "booking_1", recipientUserId: "renter_1" },
      { outboxEventId: "outbox_2" }
    );

    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: {
        id: "booking_1",
        status: "completed",
        OR: [{ renterId: "renter_1" }, { hostId: "renter_1" }]
      },
      select: { listing: { select: { title: true } } }
    });
    expect(sendNow).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "trusted@example.com",
        template: "booking_completed",
        text: "The stay has ended and the booking is now completed."
      }),
      { outboxEventId: "outbox_2" }
    );
  });
});
