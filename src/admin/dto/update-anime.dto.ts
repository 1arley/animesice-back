import { PartialType } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AudioType } from '@prisma/client';

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

  @ApiProperty({ required: false, enum: AudioType, default: AudioType.LEGENDADO })
  @IsOptional()
  audio?: AudioType;

  @ApiProperty({ required: false, default: 'A14' })
  @IsOptional()
  @IsString()
  ageRating?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genreSlugs?: string[];
}

export class UpdateAnimeDto extends PartialType(CreateAnimeDto) {}
