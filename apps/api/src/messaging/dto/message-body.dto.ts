import { IsString, MaxLength } from "class-validator";

export class MessageBodyDto {
  @IsString()
  // 8,000 UTF-16 code units still permits the service's exact 4,000-code-point
  // limit for non-BMP characters while bounding transport work at the DTO edge.
  @MaxLength(8_000)
  message!: string;
}
