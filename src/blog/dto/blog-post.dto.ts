import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBlogPostDto {
  @ApiProperty({ example: 'Guia da temporada de inverno' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title!: string;

  @ApiProperty({ example: 'guia-temporada-inverno' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug deve conter apenas letras minúsculas, números e hífens.',
  })
  @MaxLength(120)
  slug!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  description!: string;

  @ApiProperty({ example: 'Guias' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category!: string;

  @ApiProperty({ description: 'HTML do corpo do artigo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  content!: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  published!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  publishedAt?: string | null;
}

export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto) {}
