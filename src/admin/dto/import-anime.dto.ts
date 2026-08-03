import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AudioType } from '@prisma/client';

export class ImportAnimeDto {
  @ApiProperty({
    required: false,
    description: 'ID do anime no AniList (mutuamente exclusivo com search)',
  })
  @IsOptional()
  @IsNumber()
  anilistId?: number;

  @ApiProperty({
    required: false,
    description:
      'Termo de busca por título no AniList (mutuamente exclusivo com anilistId)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    required: false,
    enum: AudioType,
    default: AudioType.LEGENDADO,
    description: 'Tipo de áudio do anime importado',
  })
  @IsOptional()
  @IsEnum(AudioType)
  audio?: AudioType;
}
