// src/metrics/metrics.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/** Snapshot tipado da janela atual (estável p/ logs e futuro endpoint /metrics). */
export interface MetricsSnapshot {
  cache: {
    hitsFresh: number;
    hitsStale: number;
    misses: number;
    /** 0–100, 1 casa decimal; null quando não há lookups. */
    hitRate: number | null;
    degradedServes: number;
  };
  extractions: {
    total: number;
    failures: number;
    latencyAvgMs: number | null;
  };
  reextractions: { success: number; failure: number };
  bySource: Record<
    string,
    { extractions: number; failures: number; latencyAvgMs: number }
  >;
}

/**
 * MetricsService — observabilidade mínima em memória (single-instance).
 *
 * Contadores leves para os 3 indicadores pedidos na auditoria:
 *  - hit-rate do cache SWR do ScrapeService (fresco/stale/miss/degradado);
 *  - latência média por provider (extração);
 *  - erros por fonte (falhas de extração).
 *
 * A cada 5 minutos um snapshot é logado em uma linha JSON (grep-friendly:
 * `grep "metrics "` no stdout) e os contadores são resetados (janela).
 * Zero dependências novas; se um dia houver múltiplas instâncias, os
 * contadores viram Redis/Prometheus sem mudar a interface.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  private cacheHitsFresh = 0;
  private cacheHitsStale = 0;
  private cacheMisses = 0;
  private degradedServes = 0;
  private reextractOk = 0;
  private reextractFail = 0;

  /** Por provider: extrações, falhas e soma de latência (janela atual). */
  private readonly sources = new Map<
    string,
    { count: number; failures: number; latencySumMs: number }
  >();

  /** Registra um hit do cache SWR (fresco ou stale servido imediatamente). */
  recordCacheHit(kind: 'fresh' | 'stale'): void {
    if (kind === 'fresh') this.cacheHitsFresh += 1;
    else this.cacheHitsStale += 1;
  }

  /** Registra um miss (extração real será feita). */
  recordCacheMiss(): void {
    this.cacheMisses += 1;
  }

  /** Registra um serve degradado (fetch falhou, serviu stale em vez de errar). */
  recordDegradedServe(): void {
    this.degradedServes += 1;
  }

  /** Registra uma extração bem-sucedida com latência (ms). */
  recordExtraction(sourceId: string, latencyMs: number): void {
    const s = this.entry(sourceId);
    s.count += 1;
    s.latencySumMs += latencyMs;
  }

  /** Registra uma falha de extração de um provider. */
  recordExtractionFailure(sourceId: string): void {
    const s = this.entry(sourceId);
    s.failures += 1;
  }

  /** Registra uma re-extração (403/expiração de token). */
  recordReextract(sourceId: string, ok: boolean, latencyMs?: number): void {
    if (ok) {
      this.reextractOk += 1;
      this.recordExtraction(sourceId, latencyMs ?? 0);
    } else {
      this.reextractFail += 1;
      this.recordExtractionFailure(sourceId);
    }
  }

  /**
   * Snapshot dos contadores da janela atual (sem reset).
   *
   * Semântica do hitRate: conta como HIT também o stale servido imediatamente
   * (SWR) — mesmo que ele dispare uma revalidação em background que consome
   * capacidade do provider. É o hit-rate do ponto de vista da resposta
   * (latência de resposta), não da eficiência de cache; para medir custo de
   * provider, use extractions.total + extractions.failures.
   */
  snapshot(): MetricsSnapshot {
    let total = 0;
    let failures = 0;
    let latencySum = 0;
    const bySource: Record<
      string,
      { extractions: number; failures: number; latencyAvgMs: number }
    > = {};
    for (const [id, s] of this.sources) {
      total += s.count;
      failures += s.failures;
      latencySum += s.latencySumMs;
      bySource[id] = {
        extractions: s.count,
        failures: s.failures,
        latencyAvgMs: s.count > 0 ? Math.round(s.latencySumMs / s.count) : 0,
      };
    }

    const hits = this.cacheHitsFresh + this.cacheHitsStale;
    const lookups = hits + this.cacheMisses;

    return {
      cache: {
        hitsFresh: this.cacheHitsFresh,
        hitsStale: this.cacheHitsStale,
        misses: this.cacheMisses,
        hitRate: lookups > 0 ? Math.round((hits / lookups) * 1000) / 10 : null,
        degradedServes: this.degradedServes,
      },
      extractions: {
        total,
        failures,
        latencyAvgMs: total > 0 ? Math.round(latencySum / total) : null,
      },
      reextractions: { success: this.reextractOk, failure: this.reextractFail },
      bySource,
    };
  }

  /** Reseta a janela de contadores (chamado após cada log). */
  private reset(): void {
    this.cacheHitsFresh = 0;
    this.cacheHitsStale = 0;
    this.cacheMisses = 0;
    this.degradedServes = 0;
    this.reextractOk = 0;
    this.reextractFail = 0;
    this.sources.clear();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  private logSnapshot(): void {
    this.logger.log(`metrics ${JSON.stringify(this.snapshot())}`);
    this.reset();
  }

  private entry(sourceId: string): {
    count: number;
    failures: number;
    latencySumMs: number;
  } {
    let s = this.sources.get(sourceId);
    if (!s) {
      s = { count: 0, failures: 0, latencySumMs: 0 };
      this.sources.set(sourceId, s);
    }
    return s;
  }
}
