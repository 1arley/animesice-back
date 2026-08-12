// src/metrics/metrics.controller.ts
import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import { MetricsService } from '@/metrics/metrics.service';

/**
 * GET /metrics — snapshot dos contadores de observabilidade (hit-rate do
 * cache SWR, latência/erros por provider, re-extrações).
 *
 * Fail-closed por padrão: sem `METRICS_TOKEN` configurado o endpoint não
 * existe (404). O token chega no header `X-Metrics-Token` e é comparado por
 * hash de SHA-256 em tempo constante (timing-safe) — não expõe o valor real
 * nem permite side-channel de timing.
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Métricas de observabilidade (token protegido)' })
  snapshot(@Headers('x-metrics-token') token?: string) {
    const expected = process.env.METRICS_TOKEN;
    if (!expected) {
      throw new NotFoundException(
        'Métricas não habilitadas (METRICS_TOKEN ausente).',
      );
    }
    if (!token || !this.tokenMatches(token, expected)) {
      throw new UnauthorizedException('Token de métricas inválido.');
    }
    return this.metrics.snapshot();
  }

  private tokenMatches(provided: string, expected: string): boolean {
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }
}
