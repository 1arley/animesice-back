import { IsInt, IsNotEmpty, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RateAnimeDto {
  @ApiProperty({
    description: 'Nota de 1 a 10',
    minimum: 1,
    maximum: 10,
    example: 8,
  })
  @IsInt()
  @IsNotEmpty()
  @Min(1)
  @Max(10)
  score!: number;
}
