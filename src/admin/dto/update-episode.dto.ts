import { IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateEpisodeDto {
  @ApiProperty({ description: 'Número do episódio' })
  @IsNumber()
  @Min(1)
  number!: number;

  @ApiProperty({ required: false, default: 1, description: 'Temporada' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  season?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false, description: 'URL do vídeo (.mp4/.m3u8)' })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiProperty({
    required: false,
    description: 'URL de embed externo (iframe)',
  })
  @IsOptional()
  @IsString()
  embedUrl?: string;

  @ApiProperty({ required: false, description: 'Thumbnail URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ required: false, description: 'Duração do episódio' })
  @IsOptional()
  @IsString()
  duration?: string;
}

export class UpdateEpisodeDto extends PartialType(CreateEpisodeDto) {}
