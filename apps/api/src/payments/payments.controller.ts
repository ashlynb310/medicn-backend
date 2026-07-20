import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req
} from "@nestjs/common";
import { ApiCreatedResponse, ApiExtraModels, getSchemaPath } from "@nestjs/swagger";
import { AuthService } from "../auth/auth.service";
import {
  CheckoutSessionDto,
  CreateCheckoutSessionDto
} from "./dto/create-checkout-session.dto";
import { PaymentsService } from "./payments.service";
import { PaymentOperationsService } from "./payment-operations.service";
import { PublicRoute } from "../common/http/route-auth.decorator";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller()
export class PaymentsController {
  constructor(
    private readonly authService: AuthService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentOperations: PaymentOperationsService
  ) {}

  @Get("bookings/:id/payment-summary")
  getBookingPaymentSummary(
    @Headers("authorization") authorization: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.paymentOperations.getBookingPaymentSummary(
      this.authService.extractBearerToken(authorization),
      id
    );
  }

  @Post("payments/checkout-session")
  @RateLimit("checkout_or_cancel")
  @ApiExtraModels(CheckoutSessionDto)
  @ApiCreatedResponse({
    description:
      "Creates or reuses a Stripe Checkout Session. The bookingId carried by the configured success/cancel return URL is a locator only; clients must confirm payment through the protected booking and payment-summary endpoints.",
    schema: {
      type: "object",
      required: ["data", "meta", "error"],
      properties: {
        data: { $ref: getSchemaPath(CheckoutSessionDto) },
        meta: { type: "object", additionalProperties: true },
        error: { type: "null" }
      }
    }
  })
  async createCheckoutSession(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateCheckoutSessionDto
  ): Promise<CheckoutSessionDto> {
    const token = this.authService.extractBearerToken(authorization);
    return this.paymentsService.createCheckoutSession(token, body);
  }

  @Post("webhooks/stripe")
  @PublicRoute()
  async handleStripeWebhook(
    @Headers("stripe-signature") signature: string | undefined,
    @Body() _body: unknown,
    @Req() request: { rawBody?: Buffer }
  ) {
    if (!request.rawBody) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "The untouched Stripe webhook body is required.",
        details: {}
      });
    }

    return this.paymentsService.handleStripeWebhook(request.rawBody, signature);
  }
}
