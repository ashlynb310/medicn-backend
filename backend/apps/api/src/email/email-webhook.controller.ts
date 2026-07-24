import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { EmailWebhookService } from "./email-webhook.service";
import { PublicRoute } from "../common/http/route-auth.decorator";

@PublicRoute()
@Controller("webhooks/brevo")
export class EmailWebhookController {
  constructor(private readonly webhooks: EmailWebhookService) {}

  @Post("transactional")
  @HttpCode(200)
  receive(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    this.webhooks.assertAuthorized(authorization);
    return this.webhooks.receive(body);
  }
}
