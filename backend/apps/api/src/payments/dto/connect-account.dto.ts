import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, Matches } from "class-validator";

export class ConnectAccountTargetDto {
  @IsOptional()
  @IsUUID()
  hostUserId?: string;
}

export class CreateConnectedAccountDto extends ConnectAccountTargetDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country!: string;
}
