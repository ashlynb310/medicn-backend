import { IsInt, Max, Min } from "class-validator";

export class ReorderMediaDto {
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder!: number;
}
