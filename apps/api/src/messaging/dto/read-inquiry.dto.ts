import { IsInt, Min } from "class-validator";

export class ReadInquiryDto {
  @IsInt()
  @Min(0)
  sequence!: number;
}
