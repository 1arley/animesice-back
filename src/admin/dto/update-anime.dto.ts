import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AnimeFormat, AnimeSeason, AudioType } from '@prisma/client';

export class CreateAnimeDto {
  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  synopsis?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bannerImage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiProperty({ required: false, default: 'LANCAMENTO' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({
    required: false,
    enum: AudioType,
    default: AudioType.LEGENDADO,
  })
  @IsOptional()
  @IsEnum(AudioType)
  audio?: AudioType;

  @ApiProperty({ required: false, default: 'A14' })
  @IsOptional()
  @IsString()
  ageRating?: string;

  @ApiProperty({ required: false, enum: AnimeFormat, default: AnimeFormat.TV })
  @IsOptional()
  @IsEnum(AnimeFormat)
  format?: AnimeFormat;

  @ApiProperty({ required: false, description: 'Ano de lançamento (ex: 2024)' })
  @IsOptional()
  @IsInt()
  @Min(1900)
  year?: number;

  @ApiProperty({ required: false, enum: AnimeSeason })
  @IsOptional()
  @IsEnum(AnimeSeason)
  season?: AnimeSeason;

  @ApiProperty({ required: false, type: [String], description: 'Estúdios' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studios?: string[];

  @ApiProperty({ required: false, type: [String], description: 'Temas' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  themes?: string[];

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Títulos alternativos',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  alternativeTitles?: string[];

  @ApiProperty({ required: false, description: 'Título em japonês' })
  @IsOptional()
  @IsString()
  japaneseTitle?: string;

  @ApiProperty({
    required: false,
    description: 'Material de origem (manga, light novel, etc)',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({ required: false, description: 'Data de estreia' })
  @IsOptional()
  @IsDateString()
  releaseDate?: string;

  @ApiProperty({ required: false, description: 'Data de fim' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false, description: 'Número total de episódios' })
  @IsOptional()
  @IsInt()
  @Min(0)
  episodeCount?: number;

  @ApiProperty({
    required: false,
    default: true,
    description: 'Visível publicamente',
  })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genreSlugs?: string[];
}

export class UpdateAnimeDto extends PartialType(CreateAnimeDto) {}
