import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

/** Fontes de scrape suportadas pelo ScrapeService. */
export const SCRAPE_SOURCES = [
  'animefire',
  'animesonlinecc',
  'meusanimes',
] as const;
export type ScrapeSourceId = (typeof SCRAPE_SOURCES)[number];

export class EmbedProxyDto {
  @ApiProperty({
    example: 'https://animefire.io/anime/xxx/tudo',
    description: 'URL da página que será embedada em iframe (proxy HTML).',
  })
  @IsString()
  @IsNotEmpty()
  url!: string;

  @ApiProperty({
    required: false,
    enum: SCRAPE_SOURCES,
    description:
      'Força um adapter de scrape (animefire/animesonlinecc/meusanimes). ' +
      'Omitir = auto-detectar pelo host da URL.',
  })
  @IsOptional()
  @IsIn(SCRAPE_SOURCES, { message: 'fonte de scrape desconhecida.' })
  source?: ScrapeSourceId;

  @ApiProperty({
    required: false,
    example: 'https://animefire.io',
    description:
      'Origem do site fonte (ex: https://animefire.io) usada como ' +
      'Referer/Origin na requisição à CDN — contorna anti-hotlinking.',
  })
  @IsOptional()
  @IsString()
  referer?: string;
}
