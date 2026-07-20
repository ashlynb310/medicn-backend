import { IsBoolean } from "class-validator";

export class ArchiveInquiryDto {
  @IsBoolean()
  archived!: boolean;
}
