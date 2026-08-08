import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoadHistoryDto {
  @ApiProperty({ description: 'ID da sala' })
  @IsUUID()
  roomId!: string;

  @ApiPropertyOptional({ description: 'Quantidade máxima (padrão: 50)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
