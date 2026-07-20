import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { ArchiveInquiryDto } from "./dto/archive-inquiry.dto";
import { InquiryMessagesQueryDto } from "./dto/inquiry-messages-query.dto";
import { ListInquiriesQueryDto } from "./dto/list-inquiries-query.dto";
import { MessageBodyDto } from "./dto/message-body.dto";
import { ReadInquiryDto } from "./dto/read-inquiry.dto";
import { MessagingService } from "./messaging.service";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller("inquiries")
export class InquiriesController {
  constructor(
    private readonly authService: AuthService,
    private readonly messagingService: MessagingService
  ) {}

  @Get()
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListInquiriesQueryDto
  ) {
    return this.messagingService.listInquiries(this.token(authorization), query);
  }

  @Get(":id")
  detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Query() query: InquiryMessagesQueryDto
  ) {
    return this.messagingService.getInquiry(this.token(authorization), id, query);
  }

  @Post(":id/messages")
  @RateLimit("message_send")
  send(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: MessageBodyDto
  ) {
    return this.messagingService.sendMessage(this.token(authorization), id, body);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: ReadInquiryDto
  ) {
    return this.messagingService.markRead(this.token(authorization), id, body);
  }

  @Post(":id/close")
  @HttpCode(200)
  close(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    return this.messagingService.closeInquiry(this.token(authorization), id);
  }

  @Post(":id/archive")
  @HttpCode(200)
  archive(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: ArchiveInquiryDto
  ) {
    return this.messagingService.archiveInquiry(this.token(authorization), id, body);
  }

  private token(authorization: string | undefined) {
    return this.authService.extractBearerToken(authorization);
  }
}
