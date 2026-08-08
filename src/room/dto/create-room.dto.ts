import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({ description: 'Slug do anime' })
  @IsString()
  animeSlug!: string;

  @ApiProperty({ description: 'Número do episódio' })
  @IsInt()
  episodeNumber!: number;

  @ApiPropertyOptional({
    description: 'Limite de participantes (padrão: 20)',
    minimum: 2,
    maximum: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  maxParticipants?: number;
}
