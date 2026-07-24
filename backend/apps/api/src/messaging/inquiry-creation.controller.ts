import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { MessageBodyDto } from "./dto/message-body.dto";
import { MessagingService } from "./messaging.service";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller("listings/:listingId/inquiries")
export class InquiryCreationController {
  constructor(
    private readonly authService: AuthService,
    private readonly messagingService: MessagingService
  ) {}

  @Post()
  @RateLimit("inquiry_create")
  create(
    @Headers("authorization") authorization: string | undefined,
    @Param("listingId") listingId: string,
    @Body() body: MessageBodyDto
  ) {
    const token = this.authService.extractBearerToken(authorization);
    return this.messagingService.createInquiry(token, listingId, body);
  }
}
