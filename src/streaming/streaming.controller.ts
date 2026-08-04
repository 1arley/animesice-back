import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import express from 'express';
import { Readable } from 'stream';
import { StreamingService } from '@/streaming/streaming.service';

@ApiTags('streaming')
@Controller('stream')
export class StreamingController {
  constructor(private readonly streamingService: StreamingService) {}

  @Get('token')
  @ApiOperation({ summary: 'Gerar token de streaming para um episódio' })
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
  async getToken(
    @Query('anime') animeSlug: string,
    @Query('episode') episodeSlug: string,
    @Req() req: express.Request,
  ) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '0.0.0.0';

    const result = await this.streamingService.generateToken(
      episodeSlug,
      animeSlug,
      clientIp,
    );

    return result;
  }

  @Get('video')
  @ApiOperation({
    summary: 'Proxy de vídeo com suporte a Range (206 Partial Content)',
  })
  async proxyVideo(
    @Query('token') token: string,
    @Query('expires') expiresStr: string,
    @Query('ip') ip: string,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const expires = parseInt(expiresStr, 10);

    if (!token || !expires || !ip) {
      throw new NotFoundException('Parâmetros de streaming ausentes.');
    }

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
      const nodeStream = Readable.fromWeb(videoResponse.body);
      nodeStream.on('error', () => res.destroy());
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  }
}
