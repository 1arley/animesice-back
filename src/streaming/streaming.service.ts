import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class StreamingService {
  constructor(private readonly prisma: PrismaService) {}

  async generateToken(
    episodeSlug: string,
    animeSlug: string,
    clientIp: string,
    ttlSeconds: number = 86400,
  ) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_number: {
          animeId: anime.id,
          number: parseInt(episodeSlug, 10),
        },
      },
    });

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    if (!episode.videoUrl) {
      throw new NotFoundException('Vídeo não disponível para este episódio.');
    }

    const token = crypto.randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.streamingToken.create({
      data: {
        token,
        ip: clientIp,
        expiresAt,
        episodeId: episode.id,
      },
    });

    const expiresUnix = Math.floor(expiresAt.getTime() / 1000);

    return {
      url: `${episode.videoUrl}?token=${token}&expires=${expiresUnix}&ip=${clientIp}`,
      token,
      expires: expiresUnix,
      ip: clientIp,
      episode,
    };
  }

  async validateToken(
    token: string,
    expires: number,
    ip: string,
  ): Promise<{ videoUrl: string; episodeId: string }> {
    const now = Math.floor(Date.now() / 1000);

    if (now > expires) {
      throw new ForbiddenException('Token expirado.');
    }

    const stored = await this.prisma.streamingToken.findUnique({
      where: { token },
    });

    if (!stored) {
      throw new ForbiddenException('Token inválido.');
    }

    if (stored.ip !== ip) {
      throw new ForbiddenException('IP não corresponde ao token.');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Token expirado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: { id: stored.episodeId },
    });

    if (!episode || !episode.videoUrl) {
      throw new NotFoundException('Vídeo não encontrado.');
    }

    return { videoUrl: episode.videoUrl, episodeId: episode.id };
  }

  async proxyVideo(
    token: string,
    expires: number,
    ip: string,
    range?: string,
  ): Promise<{
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
  }> {
    const { videoUrl } = await this.validateToken(token, expires, ip);

    const headers: Record<string, string> = {};
    if (range) {
      headers['Range'] = range;
    }

    const response = await fetch(videoUrl, { headers });

    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }
}
