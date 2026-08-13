/**
 * ScheduleSync — enriquece o catálogo com metadados e horários de exibição.
 *
 * Duas responsabilidades complementares:
 *  - backfillAnilist(): animes sem anilistId são casados com AniList pelo
 *    título/slug e recebem anilistId + status/endDate + year/season/format/
 *    episodeCount/studios. Auto-enfileira continuar quando ainda há animes
 *    pendentes (batch limitado).
 *  - syncSchedules(): p/ animes com anilistId, sincroniza status + endDate
 *    reais do mediaSchedule (AniList) e deriva o horário FIXO de exibição
 *    (dia da semana + hora) gravando em AnimeSchedule — alimenta o calendário
 *    semanal e mantém o catálogo fiel ao status real (ex.: FINISHED vira
 *    CONCLUIDO, encerra o excesso de "No ar"). Um anime que sai toda segunda
 *    às 18h vira AnimeSchedule{dayOfWeek:1, time:"18:00"}.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AniListClient } from './anilist-client.service';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

/** Batch de backfill por run — enfileira continuar se ainda houver pendentes. */
const BACKFILL_BATCH = Number(process.env.WT_BACKFILL_BATCH ?? 30);
/** Limiar de similaridade p/ casar anime (mesma régua do script backfill-anilist). */
const SIMILARITY_THRESHOLD = 0.6;
/** Fuso horário exibido no calendário (animesice é pt-BR). */
const SCHEDULE_TZ = process.env.WT_SCHEDULE_TZ ?? 'America/Sao_Paulo';

@Injectable()
export class ScheduleSync {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anilist: AniListClient,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Casa animes sem anilistId com AniList e grava metadados. Retorna quantos
   * foram casados neste run; se ainda houver pendentes, auto-enfileira um novo
   * job BACKFILL_ANILIST para continuar nos próximos ticks.
   */
  async backfillAnilist(): Promise<number> {
    const pending = await this.prisma.anime.findMany({
      where: { anilistId: null },
      select: { id: true, slug: true, title: true },
      take: BACKFILL_BATCH,
    });

    let matched = 0;
    for (const anime of pending) {
      try {
        const searchQuery = anime.title || anime.slug.replace(/-/g, ' ');
        const media = await this.anilist.searchMedia(searchQuery);
        if (!media) continue;

        const mediaTitle =
          media.title?.romaji ||
          media.title?.english ||
          media.title?.native ||
          '';
        if (
          similarity(anime.title || anime.slug, mediaTitle) <
          SIMILARITY_THRESHOLD
        ) {
          continue; // ambíguo — deixa p/ revisão manual
        }

        await this.prisma.anime.update({
          where: { id: anime.id },
          data: {
            anilistId: media.id,
            status: mapStatus(media.status) ?? undefined,
            endDate: fuzzyDate(media.endDate) ?? undefined,
            year: media.seasonYear ?? null,
            season: validSeason(media.season),
            format: validFormat(media.format),
            episodeCount: media.episodes ?? null,
            studios:
              media.studios?.nodes
                ?.map((n) => n.name)
                .filter((n): n is string => Boolean(n)) ?? [],
          },
        });
        matched++;
      } catch (err) {
        console.error(
          `[WATCHTOWER] backfill falhou ${anime.slug}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const remaining = await this.prisma.anime.count({
      where: { anilistId: null },
    });
    if (remaining > 0) {
      await this.jobs.enqueue({
        type: JOB_TYPE.BACKFILL_ANILIST,
        dedupeKey: 'backfill-anilist',
        payload: {},
        priority: PRIORITY.BACKFILL_ANILIST,
      });
    }

    console.error(
      `[WATCHTOWER] backfillAnilist: ${pending.length} processados, ${matched} casados, ${remaining} restantes`,
    );
    return matched;
  }

  /**
   * Sincroniza status + datas de exibição e deriva o horário fixo (dia da
   * semana + hora) do mediaSchedule (AniList) de cada anime, gravando em
   * AnimeSchedule — alimenta o calendário semanal e mantém o catálogo
   * fiel ao status real (ex.: FINISHED vira CONCLUIDO, encerra o excesso
   * de "No ar"). Retorna qtd de animes sincronizados.
   */
  async syncSchedules(): Promise<number> {
    const animes = await this.prisma.anime.findMany({
      where: { anilistId: { not: null } },
      select: { id: true, anilistId: true, status: true },
    });

    let synced = 0;
    for (const anime of animes) {
      if (!anime.anilistId) continue;
      try {
        const summary = await this.anilist.mediaSchedule(anime.anilistId);
        const status = mapStatus(summary.status);
        const endDate = fuzzyDate(summary.endDate);

        const data: Prisma.AnimeUpdateInput = {};
        if (status && status !== anime.status) data.status = status;
        if (endDate) data.endDate = endDate;

        const slot = deriveFixedSlot(summary.schedule);
        if (slot) {
          await this.prisma.animeSchedule.deleteMany({
            where: { animeId: anime.id },
          });
          await this.prisma.animeSchedule.create({
            data: {
              animeId: anime.id,
              dayOfWeek: slot.dayOfWeek,
              time: slot.time,
            },
          });
        }

        if (Object.keys(data).length > 0) {
          await this.prisma.anime.update({
            where: { id: anime.id },
            data,
          });
        }
        synced++;
      } catch (err) {
        console.error(
          `[WATCHTOWER] syncSchedules falhou ${anime.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    console.error(
      `[WATCHTOWER] syncSchedules: ${animes.length} animes, ${synced} sincronizados`,
    );
    return synced;
  }
}

/** Mapeia status AniList para o vocabulário do catálogo. */
function mapStatus(raw?: string | null): string | null {
  switch (raw?.toUpperCase()) {
    case 'RELEASING':
    case 'NOT_YET_RELEASED':
      return 'LANCAMENTO';
    case 'FINISHED':
      return 'CONCLUIDO';
    case 'CANCELLED':
      return 'CANCELADO';
    case 'HIATUS':
      return 'HIATUS';
    default:
      return null;
  }
}

/** Converte {year, month, day} AniList em Date (null-safe, UTC ao meio-dia). */
function fuzzyDate(
  parts?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null,
): Date | null {
  if (!parts?.year) return null;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  return new Date(Date.UTC(parts.year, month - 1, day, 12));
}

/** Similaridade de título (mesma régua do scripts/backfill-anilist-id.ts). */
function similarity(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!la || !lb) return 0;
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.85;
  const setA = new Set(la.split(''));
  const setB = new Set(lb.split(''));
  let inter = 0;
  for (const c of setA) if (setB.has(c)) inter++;
  return inter / Math.max(setA.size, setB.size);
}

function validSeason(
  raw?: string | null,
): 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return ['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(upper)
    ? (upper as 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL')
    : null;
}

function validFormat(
  raw?: string | null,
): 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC' | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'].includes(upper)
    ? (upper as 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC')
    : null;
}

/**
 * Deriva o horário fixo de um anime a partir de TODOS os episódios conhecidos
 * do airingSchedule: conta (dia, hora) mais frequente ao longo da exibição.
 * Emprega o fuso horário do site (SCHEDULE_TZ). Se empatar, fica com o
 * horário mais frequente; desempate determinístico pelo último episódio.
 */
function deriveFixedSlot(
  schedule: Array<{ airingAt: number; episode: number }>,
): { dayOfWeek: number; time: string } | null {
  if (!schedule?.length) return null;

  const slotTZ = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const WEEKDAY_IDX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const counts = new Map<
    string,
    { dayOfWeek: number; time: string; count: number }
  >();
  for (const ep of schedule) {
    const d = new Date(ep.airingAt * 1000);
    if (Number.isNaN(d.getTime())) continue;
    const parts = slotTZ.formatToParts(d);
    const part = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    // hour12:false retorna "24" p/ meia-noite — normaliza p/ "00".
    const hour = part('hour') === '24' ? '00' : part('hour');
    const dayOfWeek = WEEKDAY_IDX[part('weekday')] ?? -1;
    if (dayOfWeek < 0) continue;
    const time = `${hour}:${part('minute')}`;
    const key = `${dayOfWeek}:${time}`;
    const prev = counts.get(key);
    if (prev) prev.count++;
    else counts.set(key, { dayOfWeek, time, count: 1 });
  }
  if (counts.size === 0) return null;

  let best: { dayOfWeek: number; time: string; count: number } | null = null;
  for (const slot of counts.values()) {
    if (!best || slot.count > best.count) best = slot;
  }
  if (!best) return null;
  return { dayOfWeek: best.dayOfWeek, time: best.time };
}
