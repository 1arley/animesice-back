import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import express from 'express';
import { EmbedService } from '@/embed/embed.service';
import { AnimefireScrapeService } from '@/embed/animefire-scrape.service';
import { EmbedProxyDto } from '@/embed/dto/embed-proxy.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

/**
 * Headers que o proxy nunca repassa do upstream (segurança de iframe).
 */
const FORBIDDEN_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'frame-options',
  'transfer-encoding',
]);

@ApiTags('embed')
@Controller('embed')
@UseGuards(JwtAuthGuard)
export class EmbedController {
  constructor(
    private readonly embedService: EmbedService,
    private readonly scrapeService: AnimefireScrapeService,
  ) {}

  @Get('proxy')
  @ApiOperation({
    summary:
      'Proxy de HTML removendo X-Frame-Options/CSP para iframe embed (ex: animefire.io)',
  })
  @ApiQuery({
    name: 'url',
    type: String,
    required: true,
    description: 'URL http/https da página a ser embedada.',
  })
  @ApiResponse({
    status: 200,
    description: 'HTML com headers de frame removidos.',
    content: { 'text/html': {} },
  })
  @ApiResponse({ status: 400, description: 'URL inválida ou scheme bloqueado.' })
  @ApiResponse({ status: 401, description: 'Token JWT ausente/inválido.' })
  @ApiResponse({ status: 502, description: 'Falha ao buscar destino.' })
  async proxy(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    dto: EmbedProxyDto,
    @Res() res: express.Response,
  ): Promise<void> {
    if (!dto?.url) {
      throw new BadRequestException('Parâmetro "url" é obrigatório.');
    }

    const result = await this.embedService.proxyHtml(dto.url);

    res.status(result.status);

    for (const [key, value] of Object.entries(result.headers)) {
      if (FORBIDDEN_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
      if (value === '' || value == null) continue;
      res.setHeader(key, value);
    }

    // Garante que nenhum header de frame sobreviva (defesa em profundidade).
    for (const forbidden of FORBIDDEN_RESPONSE_HEADERS.keys()) {
      res.removeHeader(forbidden);
    }

    res.setHeader('Content-Type', result.headers['content-type'] ?? 'text/html; charset=utf-8');

    res.send(result.body);
  }

  @Get('scrape')
  @ApiOperation({
    summary:
      'Extrai URL .mp4/.m3u8 de episodio do animefire via Playwright (modo alternativo ao iframe).',
  })
  @ApiQuery({
    name: 'url',
    type: String,
    required: true,
    description: 'URL do episódio em animefire.io.',
  })
  @ApiResponse({
    status: 200,
    description: 'URLs de vídeo e iframes extraídos.',
  })
  @ApiResponse({ status: 400, description: 'URL inválida.' })
  @ApiResponse({
    status: 503,
    description: 'Cloudflare bloqueou a página.',
  })
  async scrape(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    dto: EmbedProxyDto,
  ) {
    if (!dto?.url) {
      throw new BadRequestException('Parâmetro "url" é obrigatório.');
    }
    return this.scrapeService.scrapeEpisodeVideo(dto.url);
  }
}
