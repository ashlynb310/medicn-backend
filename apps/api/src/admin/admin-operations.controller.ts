import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { AdminOperationsService } from "./admin-operations.service";
import {
  ListHostTransfersQueryDto,
  ListJobExecutionsQueryDto,
  ListOperationalCommandsQueryDto,
  ListPaymentsQueryDto,
  ReconcileHostTransfersDto,
  ReconcilePaymentsDto,
  RequeueJobExecutionDto
} from "./dto/operations.dto";
import { OperationalCommandsService } from "../operations/operational-commands.service";
import { RateLimit } from "../common/http/rate-limit.decorator";

@Controller("admin/operations")
export class AdminOperationsController {
  constructor(
    private readonly auth: AuthService,
    private readonly operations: AdminOperationsService,
    private readonly commands: OperationalCommandsService
  ) {}

  @Get("status")
  status(@Headers("authorization") authorization: string | undefined) {
    return this.operations.status(this.auth.extractBearerToken(authorization));
  }

  @Get("payments")
  listPayments(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListPaymentsQueryDto
  ) {
    return this.operations.listPayments(
      this.auth.extractBearerToken(authorization),
      query
    );
  }

  @Get("payments/:id")
  getPayment(
    @Headers("authorization") authorization: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.operations.getPayment(this.auth.extractBearerToken(authorization), id);
  }

  @Get("host-transfers")
  listHostTransfers(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListHostTransfersQueryDto
  ) {
    return this.operations.listHostTransfers(
      this.auth.extractBearerToken(authorization),
      query
    );
  }

  @Get("host-transfers/:id")
  getHostTransfer(
    @Headers("authorization") authorization: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.operations.getHostTransfer(
      this.auth.extractBearerToken(authorization),
      id
    );
  }

  @Get("job-executions/failed")
  listFailedJobExecutions(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListJobExecutionsQueryDto
  ) {
    return this.operations.listJobExecutions(
      this.auth.extractBearerToken(authorization),
      query,
      true
    );
  }

  @Get("job-executions")
  listJobExecutions(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListJobExecutionsQueryDto
  ) {
    return this.operations.listJobExecutions(
      this.auth.extractBearerToken(authorization),
      query
    );
  }

  @Get("job-executions/:id")
  getJobExecution(
    @Headers("authorization") authorization: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.operations.getJobExecution(
      this.auth.extractBearerToken(authorization),
      id
    );
  }

  @Post("job-executions/:id/requeue")
  @HttpCode(202)
  @RateLimit("admin_command")
  requeueJobExecution(
    @Headers("authorization") authorization: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() input: RequeueJobExecutionDto
  ) {
    return this.commands.queueJobRequeue(
      this.auth.extractBearerToken(authorization),
      id,
      input
    );
  }

  @Post("reconciliation/payments")
  @HttpCode(202)
  @RateLimit("admin_command")
  reconcilePayments(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: ReconcilePaymentsDto
  ) {
    return this.commands.queuePaymentReconciliation(
      this.auth.extractBearerToken(authorization),
      input
    );
  }

  @Post("reconciliation/host-transfers")
  @HttpCode(202)
  @RateLimit("admin_command")
  reconcileHostTransfers(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: ReconcileHostTransfersDto
  ) {
    return this.commands.queueHostTransferReconciliation(
      this.auth.extractBearerToken(authorization),
      input
    );
  }

  @Get("commands")
  listCommands(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: ListOperationalCommandsQueryDto
  ) {
    return this.operations.listCommands(
      this.auth.extractBearerToken(authorization),
      query
    );
  }

  @Get("commands/:id")
  getCommand(
    @Headers("authorization") authorization: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.operations.getCommand(this.auth.extractBearerToken(authorization), id);
  }
}
