import { Type, Transform } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import {
  HostTransferReversalStatus,
  HostTransferStatus,
  JobExecutionState,
  OperationalCommandStatus,
  OperationalCommandType,
  PaymentStatus
} from "@prisma/client";

export const OPERATIONAL_PAGE_LIMIT = 100;
export const RECONCILIATION_BATCH_LIMIT = 25;
export const OPERATIONAL_DATE_RANGE_DAYS = 366;

export class OperationalPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OPERATIONAL_PAGE_LIMIT)
  limit = 20;

  @IsOptional()
  @IsISO8601({ strict: true })
  createdFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  createdTo?: string;
}

export class ListPaymentsQueryDto extends OperationalPageQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsUUID()
  bookingId?: string;
}

export class ListHostTransfersQueryDto extends OperationalPageQueryDto {
  @IsOptional()
  @IsEnum(HostTransferStatus)
  status?: HostTransferStatus;

  @IsOptional()
  @IsEnum(HostTransferReversalStatus)
  reversalStatus?: HostTransferReversalStatus;

  @IsOptional()
  @IsUUID()
  bookingId?: string;
}

export class ListJobExecutionsQueryDto extends OperationalPageQueryDto {
  @IsOptional()
  @IsEnum(JobExecutionState)
  state?: JobExecutionState;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9_:-]+$/)
  jobType?: string;

  @IsOptional()
  @IsIn(["email", "media", "maps", "operations"])
  queueName?: string;
}

export class ListOperationalCommandsQueryDto extends OperationalPageQueryDto {
  @IsOptional()
  @IsEnum(OperationalCommandType)
  commandType?: OperationalCommandType;

  @IsOptional()
  @IsEnum(OperationalCommandStatus)
  status?: OperationalCommandStatus;
}

export class OperationalCommandRequestDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9:_-]+$/)
  idempotencyKey!: string;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class RequeueJobExecutionDto extends OperationalCommandRequestDto {}

export class ReconciliationRequestDto extends OperationalCommandRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECONCILIATION_BATCH_LIMIT)
  limit = 10;

  @IsOptional()
  @IsISO8601({ strict: true })
  staleBefore?: string;
}

export class ReconcilePaymentsDto extends ReconciliationRequestDto {
  @IsOptional()
  @IsUUID()
  paymentId?: string;
}

export class ReconcileHostTransfersDto extends ReconciliationRequestDto {
  @IsOptional()
  @IsUUID()
  hostTransferId?: string;
}
