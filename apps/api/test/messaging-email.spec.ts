import type { ConfigService } from "@nestjs/config";
import { EmailService } from "../src/email/email.service";
import type { JobsService } from "../src/jobs/jobs.service";
import type { PrismaService } from "../src/prisma/prisma.service";

describe("messaging email resolution", () => {
  it("resolves the trusted recipient server-side without loading the message body", async () => {
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue({
          inquiry: { listing: { title: "Safe listing title" } }
        })
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: "trusted@example.com" })
      }
    };
    const config = { get: jest.fn((key: string) => key === "EMAIL_PROVIDER" ? "local" : undefined) };
    const service = new EmailService(
      { enqueue: jest.fn() } as unknown as JobsService,
      config as unknown as ConfigService,
      prisma as unknown as PrismaService
    );
    const sendNow = jest.spyOn(service, "sendNow").mockResolvedValue({
      provider: "local",
      messageId: "local-message",
      acceptedAt: new Date(),
      simulated: true
    });

    await service.sendMessagingNotificationNow(
      {
        inquiryId: "inquiry-1",
        messageId: "message-1",
        recipientUserId: "host-1",
        template: "inquiry_new_message"
      },
      { outboxEventId: "outbox-1" }
    );

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { inquiry: { select: { listing: { select: { title: true } } } } }
      })
    );
    expect(sendNow).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "trusted@example.com",
        template: "inquiry_new_message",
        text: expect.not.stringContaining("message-1")
      }),
      { outboxEventId: "outbox-1" }
    );
  });
});
