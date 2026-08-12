import {
  Controller,
  Get,
  Query,
  Res,
  Headers,
  UseGuards,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import express from 'express';
import { EmbedService } from '@/embed/embed.service';
import { ScrapeService } from '@/embed/scrape/scrape.service';
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

/**
 * CSP p/ HTML proxyado: sandbox sem allow-same-origin => origem opaca no
 * navegador, sem acesso a cookies/localStorage da API nem a fetch() same-origin.
 * allow-scripts preserva o player (video.js) funcionando. allow-forms removido
 * (evita CSRF same-site contra a própria API).
 */
const PROXY_CSP_SANDBOX = 'sandbox allow-scripts allow-popups allow-modals';

@ApiTags('embed')
@Controller('embed')
export class EmbedController {
  constructor(
    private readonly embedService: EmbedService,
    private readonly scrapeService: ScrapeService,
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
  @ApiResponse({
    status: 400,
    description: 'URL inválida ou scheme bloqueado.',
  })
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

    // Proteção de XSS no domínio da API: HTML de terceiros roda em sandbox
    // (origem opaca) e o tipo de conteúdo não pode ser reinterpretado.
    res.setHeader('Content-Security-Policy', PROXY_CSP_SANDBOX);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.setHeader(
      'Content-Type',
      result.headers['content-type'] ?? 'text/html; charset=utf-8',
    );

    res.send(result.body);
  }

  @Get('media')
  @ApiOperation({
    summary:
      'Proxy de mídia (.mp4/.m3u8/.ts): injeta Referer/Origin/UA anti-hotlinking e faz streaming com Range.',
  })
  @ApiQuery({
    name: 'url',
    type: String,
    required: true,
    description: 'URL http/https da mídia (.mp4, .m3u8 ou segmento .ts).',
  })
  @ApiResponse({ status: 200, description: 'Stream binário da mídia.' })
  @ApiResponse({
    status: 400,
    description: 'URL inválida ou scheme bloqueado.',
  })
  @ApiResponse({ status: 502, description: 'Falha ao buscar a mídia.' })
  @ApiResponse({
    status: 503,
    description: 'CDN recusou (anti-hotlinking/token expirado).',
  })
  async media(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    dto: EmbedProxyDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: express.Response,
  ): Promise<void> {
    if (!dto?.url) {
      throw new BadRequestException('Parâmetro "url" é obrigatório.');
    }

    const result = await this.embedService.proxyMedia(
      dto.url,
      headers,
      dto.referer,
    );

    res.status(result.status);
    for (const [key, value] of Object.entries(result.headers)) {
      if (value === '' || value == null) continue;
      res.setHeader(key, value);
    }

    // Streaming: pipe do body (Readable) p/ a resposta Express.
    const { pipeline } = await import('stream/promises');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Em erro de stream (cliente desconecta), apenas finaliza sem crashar.
    pipeline(result.body, res).catch(() => {
      if (!res.headersSent) res.destroy();
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('scrape')
  @ApiOperation({
    summary:
      'Extrai URL .mp4/.m3u8 + iframes de episódio (multi-fonte) via Playwright.',
  })
  @ApiQuery({
    name: 'url',
    type: String,
    required: true,
    description:
      'URL do episódio (animefire.io, animesonlinecc.to, meusanimes.blog, ...).',
  })
  @ApiQuery({
    name: 'source',
    type: String,
    required: false,
    enum: ['animefire', 'animesonlinecc', 'meusanimes'],
    description: 'Força um adapter. Omitir = auto-detectar pelo host.',
  })
  @ApiResponse({
    status: 200,
    description: 'URLs de vídeo e iframes extraídos.',
  })
  @ApiResponse({
    status: 400,
    description: 'URL inválida ou fonte desconhecida.',
  })
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
    return this.scrapeService.scrapeEpisodeVideo(dto.url, dto.source);
  }
}
