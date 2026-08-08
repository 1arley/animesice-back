import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProgressDto {
  @ApiProperty({ description: 'Progresso em segundos', minimum: 0 })
  @IsInt()
  @Min(0)
  progress!: number;

  @ApiPropertyOptional({ description: 'Duração total em segundos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number;

  @ApiPropertyOptional({ description: 'Episódio assistido completamente' })
  @IsOptional()
  completed?: boolean;
}
