import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateCheckoutSessionDto {
  @IsUUID()
  bookingId!: string;
}

export class CheckoutSessionDto {
  @ApiProperty({ description: "Stripe Checkout Session identifier." })
  checkoutSessionId!: string;

  @ApiProperty({
    description: "Stripe-hosted Checkout URL.",
    format: "uri"
  })
  checkoutUrl!: string;

  @ApiProperty({
    description: "Checkout Session expiry as an ISO 8601 timestamp.",
    format: "date-time"
  })
  expiresAt!: string;
}
