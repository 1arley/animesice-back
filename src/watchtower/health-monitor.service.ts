/**
 * HealthMonitor — registra outcome de tentativas por fonte e ranqueia fontes.
 *
 * Score: taxaSucesso × (1 / (1 + avgLatencyNorm)). Atualiza WatchtowerSourceHealth.
 *
 * O desligamento é um CIRCUIT BREAKER, não um flag permanente:
 *  1. Só abre com falha de AVAILABILITY **confirmada pelo probe da home**. Uma
 *     403 numa página de episódio isolada (bot-check/WAF por URL) é comum e
 *     temporária; antes ela contava como "fonte fora do ar" e derrubava a fonte
 *     inteira pro resto do site em ~5 extrações de um job em lote.
 *  2. Fica desligado por DISABLE_COOLDOWN_MS e **volta sozinho** — sem ninguém
 *     reativando na mão todo dia.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { OPTIONAL_SOURCE_IDS, SOURCE_IDS } from './watchtower.types';

const DISABLE_THRESHOLD = 5;

/** Tempo desligado antes de voltar sozinha. */
const DISABLE_COOLDOWN_MS = 30 * 60_000;

/** Probe da home no máximo 1x por fonte a cada 60s (falha em rajada). */
const PROBE_TTL_MS = 60_000;

const PROBE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Home de cada fonte — prova se o SITE inteiro responde, não só 1 episódio. */
const SOURCE_LIVENESS_URLS: Record<string, string> = {
  meusanimes: 'https://meusanimes.blog/',
  animesonline: 'https://animesonline.cloud/',
  animesonlinecc: 'https://animesonlinecc.to/',
  animefire: 'https://animefire.io/',
  topanimes: 'https://topanimes.net/',
  animesorion: 'https://animesorion.cc/',
  animesdigital: 'https://animesdigital.org/',
  tioanime: 'https://tioanime.com/',
};

export type LivenessProbe = (url: string) => Promise<boolean>;

/** 403/429 = bloqueio (WAF). 404 ainda prova que o host nos atende. */
const defaultLivenessProbe: LivenessProbe = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      headers: { 'user-agent': PROBE_UA, accept: 'text/html,*/*;q=0.8' },
    });
    return res.status < 500 && res.status !== 403 && res.status !== 429;
  } catch {
    return false;
  }
};

export type SourceFailureKind =
  'AVAILABILITY' | 'CONTENT_MISS' | 'EXTRACTION' | 'VALIDATION' | 'CAPACITY';

export interface SourceFailure {
  kind: SourceFailureKind;
  error?: string;
}

interface SourceScore {
  sourceId: string;
  score: number;
  disabled: boolean;
}

@Injectable()
export class HealthMonitor {
  /** Substituível em teste (e por quem quiser outro probe). */
  probeUp: LivenessProbe = defaultLivenessProbe;

  private readonly probeCache = new Map<string, { at: number; up: boolean }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * O site inteiro da fonte responde? Cache curto: em rajada de falhas o probe
   * roda uma vez, não uma vez por extração.
   */
  private async siteUp(sourceId: string): Promise<boolean> {
    const url = SOURCE_LIVENESS_URLS[sourceId];
    if (!url) return true; // sem home conhecida: não inventa falha global
    const cached = this.probeCache.get(sourceId);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.up;
    const up = await this.probeUp(url).catch(() => false);
    this.probeCache.set(sourceId, { at: Date.now(), up });
    return up;
  }

  async recordSuccess(sourceId: string, latencyMs: number): Promise<void> {
    await this.prisma.watchtowerSourceHealth
      .upsert({
        where: { sourceId },
        update: {},
        create: { sourceId },
      })
      .catch(() => undefined);
    // Update atômico em 1 statement (sem read-modify-write => sem lost update
    // sob concorrência entre workers/instâncias).
    await this.prisma.$executeRaw`
      UPDATE "WatchtowerSourceHealth"
      SET
        "successCount" = "successCount" + 1,
        "consecutiveFailures" = 0,
        "avgLatencyMs" = CASE
          WHEN "successCount" = 0 THEN ${Math.round(latencyMs)}
          ELSE ROUND(("avgLatencyMs" * "successCount" + ${Math.round(latencyMs)}) / ("successCount" + 1))
        END,
        "lastSuccessAt" = NOW(),
        "lastCheckedAt" = NOW(),
        "lastError" = NULL,
        "lastFailureKind" = NULL,
        "disabled" = CASE WHEN "disabledByAdmin" THEN true ELSE false END
      WHERE "sourceId" = ${sourceId}
    `;
  }

  async recordFailure(
    sourceId: string,
    failure: SourceFailure = { kind: 'AVAILABILITY' },
  ): Promise<void> {
    await this.prisma.watchtowerSourceHealth
      .upsert({
        where: { sourceId },
        update: {},
        create: { sourceId },
      })
      .catch(() => undefined);
    const error = failure.error?.slice(0, 2000) ?? null;
    // Só AVAILABILITY abre o circuito, e só com o site inteiro fora do ar. 403
    // numa página isolada (bot-check por URL) cai como EXTRACTION: conta no
    // contador de extração e NÃO derruba a fonte.
    const kind =
      failure.kind === 'AVAILABILITY' && (await this.siteUp(sourceId))
        ? 'EXTRACTION'
        : failure.kind;
    if (kind === 'AVAILABILITY') {
      await this.prisma.$executeRaw`
        UPDATE "WatchtowerSourceHealth"
        SET
          "failureCount" = "failureCount" + 1,
          "availabilityFailures" = "availabilityFailures" + 1,
          "consecutiveFailures" = "consecutiveFailures" + 1,
          "lastFailureAt" = NOW(),
          "lastCheckedAt" = NOW(),
          "lastError" = ${error},
          "lastFailureKind" = ${kind},
          "disabled" = CASE
            WHEN "consecutiveFailures" + 1 >= ${DISABLE_THRESHOLD} THEN true
            ELSE "disabled"
          END
        WHERE "sourceId" = ${sourceId}
      `;
      return;
    }

    const counter = {
      CONTENT_MISS: { contentMisses: { increment: 1 } },
      EXTRACTION: { extractionFailures: { increment: 1 } },
      VALIDATION: { validationFailures: { increment: 1 } },
      CAPACITY: { capacityFailures: { increment: 1 } },
    }[kind];
    await this.prisma.watchtowerSourceHealth.update({
      where: { sourceId },
      data: {
        failureCount: { increment: 1 },
        ...counter,
        lastFailureAt: new Date(),
        lastCheckedAt: new Date(),
        lastError: error,
        lastFailureKind: kind,
      },
    });
  }

  /**
   * Circuit breaker: fonte auto-desativada volta sozinha quando o cooldown
   * expira. `disabledByAdmin` nunca é tocado, e sem `lastFailureAt` não há
   * cooldown conhecido — nesse caso deixa desligado (reviveOne diário cobre).
   *
   * @returns true se reabilitou agora.
   */
  private async restoreIfCooldownExpired(
    sourceId: string,
    row: { disabledByAdmin: boolean | null; lastFailureAt: Date | null },
  ): Promise<boolean> {
    if (row.disabledByAdmin) return false;
    const last = row.lastFailureAt ? row.lastFailureAt.getTime() : 0;
    if (!last || Date.now() - last < DISABLE_COOLDOWN_MS) return false;
    await this.prisma.watchtowerSourceHealth
      .update({
        where: { sourceId },
        data: { disabled: false, consecutiveFailures: 0 },
      })
      .catch(() => undefined);
    return true;
  }

  /** true se a fonte está marcada disabled pelo auto-desativação (>= N falhas). */
  async isDisabled(sourceId: string): Promise<boolean> {
    const row = await this.prisma.watchtowerSourceHealth.findUnique({
      where: { sourceId },
      select: {
        disabled: true,
        disabledByAdmin: true,
        lastFailureAt: true,
      },
    });
    if (row?.disabled !== true) return false;
    return !(await this.restoreIfCooldownExpired(sourceId, row));
  }

  /** Fontes ativas, ordenadas por score (saudável 1º). meusanimes = base prioritária. */
  async rankedSources(): Promise<string[]> {
    const rows = await this.prisma.watchtowerSourceHealth.findMany();
    // Cooldown expirado: reabilita antes de rankear, senão a fonte fica fora
    // da rotação mesmo sem ninguém tocar na mão.
    for (const row of rows) {
      if (
        row.disabled &&
        (await this.restoreIfCooldownExpired(row.sourceId, row))
      )
        row.disabled = false;
    }
    const map = new Map(rows.map((r) => [r.sourceId, r]));

    const enabledIds = [...SOURCE_IDS, ...OPTIONAL_SOURCE_IDS].filter(
      (id) =>
        id !== 'animesdigital' || process.env.ANIMESDIGITAL_ENABLED === 'true',
    );
    const scored: SourceScore[] = enabledIds.map((id) => {
      const row = map.get(id);
      if (row?.disabled) return { sourceId: id, score: -1, disabled: true };
      const total = (row?.successCount ?? 0) + (row?.failureCount ?? 0);
      const successRate = total === 0 ? 0.7 : (row?.successCount ?? 0) / total;
      const latencyNorm = Math.min((row?.avgLatencyMs ?? 3000) / 10_000, 1);
      const score = successRate * (1 / (1 + latencyNorm));
      return { sourceId: id, score, disabled: false };
    });

    const active = scored.filter((s) => !s.disabled);
    active.sort((a, b) => b.score - a.score);

    // Garante meusanimes no topo quando scores similares (delta < 0.1)
    const result = active.map((s) => s.sourceId);
    const meusaIdx = result.indexOf('meusanimes');
    if (meusaIdx > 0) {
      const top = scored.find((s) => s.sourceId === result[0]);
      const meusa = scored.find((s) => s.sourceId === 'meusanimes');
      if (top && meusa && Math.abs(top.score - meusa.score) < 0.1) {
        result.splice(meusaIdx, 1);
        result.unshift('meusanimes');
      }
    }
    return result;
  }

  /** Canário: reabilita 1 fonte disabled p/ testar recuperação. */
  async reviveOne(): Promise<string | null> {
    const candidate = await this.prisma.watchtowerSourceHealth.findFirst({
      where: {
        disabled: true,
        disabledByAdmin: false,
      },
      orderBy: { lastFailureAt: 'desc' },
    });
    if (!candidate) return null;
    await this.prisma.watchtowerSourceHealth.update({
      where: { sourceId: candidate.sourceId },
      data: { disabled: false, consecutiveFailures: 0 },
    });
    return candidate.sourceId;
  }
}
