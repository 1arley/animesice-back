import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Seções do showcase do perfil, na ordem em que o front deve renderizar.
 * O front recebe a lista já normalizada e só itera — nunca ordena por conta
 * própria, para que a ordem escolhida no /configuracoes seja respeitada.
 */
export const SHOWCASE_SECTIONS = [
  'FEATURED',
  'FAVORITES',
  'COLLECTION',
  'MEDALS',
] as const;

export type ShowcaseSection = (typeof SHOWCASE_SECTIONS)[number];

/**
 * Recorte de imagem (avatar ou capa).
 *
 * `{x, y}` é o ponto focal em % de 0 a 100 — o front translate para
 * `object-position` e assim o recorte sobrevive a qualquer largura de
 * exibição. `{scale}` é o zoom do crop entre 1 e 3. Guardamos coordenadas,
 * não pixels recortados: a mesma configuração serve a desktop e a mobile, e
 * o backend não precisa de biblioteca de imagem.
 */
export class ImageCropDto {
  @ApiProperty({ minimum: 0, maximum: 100, example: 50 })
  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @ApiProperty({ minimum: 0, maximum: 100, example: 50 })
  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;

  @ApiProperty({ minimum: 1, maximum: 3, example: 1.25 })
  @IsNumber()
  @Min(1)
  @Max(3)
  scale!: number;
}

/** `null` em qualquer campo volta o recorte ao enquadramento padrão. */
export class UpdateCropsDto {
  @ApiProperty({ type: ImageCropDto, required: false, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageCropDto)
  avatarCrop?: ImageCropDto | null;

  @ApiProperty({ type: ImageCropDto, required: false, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageCropDto)
  profileCoverCrop?: ImageCropDto | null;
}

export class UpdateShowcaseSectionsDto {
  @ApiProperty({
    enum: SHOWCASE_SECTIONS,
    isArray: true,
    example: ['FEATURED', 'MEDALS'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SHOWCASE_SECTIONS.length)
  @IsEnum(SHOWCASE_SECTIONS, { each: true })
  sections!: ShowcaseSection[];
}

export class UpdateProfileBackgroundDto {
  @ApiProperty({ required: false, nullable: true, example: 'aurora' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  key?: string | null;
}
