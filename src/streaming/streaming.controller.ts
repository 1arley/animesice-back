import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import express from 'express';
import { StreamingService } from '@/streaming/streaming.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i;

/**
 * Extrai o IP real do cliente do request server-side (nunca do query param).
 * Só confia em x-forwarded-for quando atrás de proxy confiável (TRUST_PROXY);
 * caso contrário usa socket.remoteAddress. Evita spoofing do IP-vínculo.
 */
function clientIpFromRequest(
  req: express.Request,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]!.trim();
    }
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

/**
 * Origem pública do backend (scheme + host) usada p/ montar URLs absolutas de
 * proxy de mídia `/embed/media` no caminho `/stream/source`. Em prod, use
 * PUBLIC_BACKEND_URL; x-forwarded-* só é aceito com TRUST_PROXY e host válido.
 */
function backendOrigin(
  req: express.Request,
  trustProxy: boolean,
  config: ConfigService,
): string {
  const configured = config.get<string>('PUBLIC_BACKEND_URL');
  if (configured) return configured.replace(/\/$/, '');

  if (trustProxy) {
    const proto = req.headers['x-forwarded-proto'];
    const host = req.headers['x-forwarded-host'];
    if (typeof host === 'string' && HOSTNAME_RE.test(host)) {
      const scheme =
        typeof proto === 'string' && /^https?$/i.test(proto)
          ? proto.toLowerCase()
          : 'https';
      return `${scheme}://${host}`;
    }
  }

  const host = req.headers['host'];
  if (typeof host === 'string' && HOSTNAME_RE.test(host)) {
    return `${req.protocol}://${host}`;
  }
  return 'http://localhost';
}

@ApiTags('streaming')
@Controller('stream')
export class StreamingController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly configService: ConfigService,
  ) {}

  private get trustProxy(): boolean {
    return this.configService.get<string>('TRUST_PROXY') === 'true';
  }

  /**
   * Endpoint público de source do player (sem JWT).
   *
   * Resolve o videoUrl de um episódio (re-extraindo da fonte via HTTP puro
   * quando necessário) e devolve `src` — URL absoluta do proxy de mídia
   * `/embed/media` que injeta Referer/Origin/UA anti-hotlinking e usa o IP
   * de saída do backend (mesmo IP que extraiu o token da CDN).
   *
   * O player no frontend só precisa desta URL; não há token nem IP-vínculo
   * client-side. Pensado p/ demo/prod onde o catálogo NOW tem videoUrl e o
   * backend compartilha o IP de saída com a CDN.
   */
  @Get('source')
  @ApiOperation({
    summary:
      'Origem do player (público): resolve videoUrl, re-extrai da fonte se necessário, devolve src do proxy de mídia.',
  })
  @ApiResponse({
    status: 200,
    description: 'Source resolvido',
    schema: {
      type: 'object',
      properties: {
        animeSlug: { type: 'string' },
        episodeNumber: { type: 'number' },
        src: { type: 'string' },
        rawVideoUrl: { type: 'string', nullable: true },
        embedUrl: { type: 'string', nullable: true },
        reextracted: { type: 'boolean' },
        thumbnailUrl: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Anime/episódio/vídeo não encontrado.',
  })
  async getSource(
    @Query('anime') animeSlug: string,
    @Query('episode') episodeSlug: string,
    @Req() req: express.Request,
  ) {
    const episodeNumber = parseInt(episodeSlug, 10);
    if (!animeSlug || Number.isNaN(episodeNumber)) {
      throw new NotFoundException(
        'Parâmetros `anime` e `episode` são obrigatórios.',
      );
    }
    return this.streamingService.getSource(
      animeSlug,
      episodeNumber,
      backendOrigin(req, this.trustProxy, this.configService),
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Get('token')
  @ApiOperation({
    summary: 'Gerar token de streaming para um episódio (autenticado)',
  })
  @ApiResponse({
    status: 200,
    description: 'Token gerado com sucesso',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        token: { type: 'string' },
        expires: { type: 'number' },
        ip: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Não autenticado.' })
  async getToken(
    @Query('anime') animeSlug: string,
    @Query('episode') episodeSlug: string,
    @Req() req: express.Request,
  ) {
    const clientIp = clientIpFromRequest(req, this.trustProxy);

    return this.streamingService.generateToken(
      episodeSlug,
      animeSlug,
      clientIp,
    );
  }

  @Get('video')
  @ApiOperation({
    summary: 'Proxy de vídeo com suporte a Range (206 Partial Content)',
  })
  async proxyVideo(
    @Query('token') token: string,
    @Query('expires') expiresStr: string,
    // `ip` no query é mantido p/ compat com o front, mas é IGNORADO — o IP
    // real vem do request server-side. Forjar `&ip=` não bypassa o vínculo.
    @Query('ip') _ipIgnored: string,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const expires = parseInt(expiresStr, 10);

    if (!token || !expires) {
      throw new NotFoundException('Parâmetros de streaming ausentes.');
    }

    const ip = clientIpFromRequest(req, this.trustProxy);
    const range = req.headers.range;

    let videoResponse: Awaited<
      ReturnType<typeof this.streamingService.proxyVideo>
    >;
    try {
      videoResponse = await this.streamingService.proxyVideo(
        token,
        expires,
        ip,
        range,
      );
    } catch (err) {
      if (err instanceof ForbiddenException) {
        res.status(403).json({ message: err.message });
        return;
      }
      if (err instanceof NotFoundException) {
        res.status(404).json({ message: err.message });
        return;
      }
      throw err;
    }

    res.status(videoResponse.status);

    const headersToProxy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'etag',
      'last-modified',
      'x-proxy-error',
    ];

    for (const key of headersToProxy) {
      const val = videoResponse.headers.get(key);
      if (val) {
        res.setHeader(key, val);
      }
    }

    if (videoResponse.status === 206 || videoResponse.status === 200) {
      if (!videoResponse.body) {
        res.end();
        return;
      }
      // streaming (Readable) -> Express response via pipeline.
      const { pipeline } = await import('stream/promises');
      pipeline(videoResponse.body, res).catch(() => {
        if (!res.headersSent) res.destroy();
      });
    } else {
      res.end();
    }
  }
}
