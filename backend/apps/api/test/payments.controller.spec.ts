import { BadRequestException } from "@nestjs/common";
import type { AuthService } from "../src/auth/auth.service";
import { PaymentsController } from "../src/payments/payments.controller";
import type { PaymentsService } from "../src/payments/payments.service";

describe("PaymentsController Stripe raw body", () => {
  const authService = {} as AuthService;

  it("forwards the untouched raw Buffer to webhook processing", async () => {
    const paymentsService = {
      handleStripeWebhook: jest.fn().mockResolvedValue({ received: true })
    };
    const controller = new PaymentsController(
      authService,
      paymentsService as unknown as PaymentsService,
      {} as never
    );
    const rawBody = Buffer.from('{"id":"evt_1"}');

    await controller.handleStripeWebhook("signature", {}, { rawBody });

    expect(paymentsService.handleStripeWebhook).toHaveBeenCalledWith(
      rawBody,
      "signature"
    );
  });

  it("rejects a webhook request when Nest rawBody is unavailable", async () => {
    const paymentsService = { handleStripeWebhook: jest.fn() };
    const controller = new PaymentsController(
      authService,
      paymentsService as unknown as PaymentsService,
      {} as never
    );

    await expect(
      controller.handleStripeWebhook("signature", {}, {})
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentsService.handleStripeWebhook).not.toHaveBeenCalled();
  });
});
