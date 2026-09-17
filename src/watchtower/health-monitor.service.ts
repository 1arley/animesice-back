/**
 * HealthMonitor — registra outcome de tentativas por fonte e ranqueia fontes.
 *
 * Score: taxaSucesso × (1 / (1 + avgLatencyNorm)). Atualiza WatchtowerSourceHealth.
 * Após consecutiveFailures >= DISABLE_THRESHOLD, marca disabled=true.
 * Canário: getRankedSources filtra disabled, mas getRankedSourcesWithCanary
 * inclui 1 fonte reabilitada p/ teste de recuperação (chamado periodicamente).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { OPTIONAL_SOURCE_IDS, SOURCE_IDS } from './watchtower.types';

const DISABLE_THRESHOLD = 5;

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
  constructor(private readonly prisma: PrismaService) {}

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
    if (failure.kind === 'AVAILABILITY') {
      await this.prisma.$executeRaw`
        UPDATE "WatchtowerSourceHealth"
        SET
          "failureCount" = "failureCount" + 1,
          "availabilityFailures" = "availabilityFailures" + 1,
          "consecutiveFailures" = "consecutiveFailures" + 1,
          "lastFailureAt" = NOW(),
          "lastCheckedAt" = NOW(),
          "lastError" = ${error},
          "lastFailureKind" = ${failure.kind},
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
    }[failure.kind];
    await this.prisma.watchtowerSourceHealth.update({
      where: { sourceId },
      data: {
        failureCount: { increment: 1 },
        ...counter,
        lastFailureAt: new Date(),
        lastCheckedAt: new Date(),
        lastError: error,
        lastFailureKind: failure.kind,
      },
    });
  }

  /** Fontes ativas, ordenadas por score (saudável 1º). meusanimes = base prioritária. */
  async rankedSources(): Promise<string[]> {
    const rows = await this.prisma.watchtowerSourceHealth.findMany();
    const map = new Map(rows.map((r) => [r.sourceId, r]));

    const enabledIds = [...SOURCE_IDS, ...OPTIONAL_SOURCE_IDS].filter(
      (id) =>
        (id !== 'tioanime' ||
          process.env.NODE_ENV === 'test' ||
          process.env.TIOANIME_ENABLED === 'true') &&
        (id !== 'animesdigital' ||
          process.env.ANIMESDIGITAL_ENABLED === 'true'),
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

  /** true se a fonte está marcada disabled pelo auto-desativação (>= N falhas). */
  async isDisabled(sourceId: string): Promise<boolean> {
    const row = await this.prisma.watchtowerSourceHealth.findUnique({
      where: { sourceId },
      select: { disabled: true },
    });
    return row?.disabled === true;
  }

  /** Canário: reabilita 1 fonte disabled p/ testar recuperação. */
  async reviveOne(): Promise<string | null> {
    const candidate = await this.prisma.watchtowerSourceHealth.findFirst({
      where: { disabled: true, disabledByAdmin: false },
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
