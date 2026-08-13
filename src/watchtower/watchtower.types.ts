/**
 * Tipos e constantes do Anime Watchtower.
 *
 * Fila de jobs -> orquestrador -> workers especializados.
 * Anti-duplicação por (type+dedupeKey) no Postgres.
 */

/** Tipos de job da fila. */
export const JOB_TYPE = {
  /** Monitora animes em lançamento (AniList airingSchedule) -> enfileira EXTRAÇÕES */
  CHECK_RELEASES: 'CHECK_RELEASES',
  /** Descobre animes da temporada atual (AniList season) -> cria catálogo */
  DISCOVER_SEASON: 'DISCOVER_SEASON',
  /** Escaneia catálogo do meusanimes (/a/{slug}/) -> descobre todas seasons+eps */
  SCAN_CATALOG: 'SCAN_CATALOG',
  /** Extrai vídeo de um episódio (itera fontes) */
  EXTRACT_EPISODE: 'EXTRACT_EPISODE',
  /** Valida resultado da extração (campos + probe de vídeo) */
  VALIDATE_EPISODE: 'VALIDATE_EPISODE',
  /** Repara episódio com vídeo morto/nulo */
  REPAIR_EPISODE: 'REPAIR_EPISODE',
  /** Sincroniza airingSchedule (completa episódios esperados) */
  SYNC_AIRING: 'SYNC_AIRING',
  /** Detecta gaps nos episódios (ex: pulou do ep 110 → 1037) e enfileira SCAN_CATALOG */
  GAP_CHECK: 'GAP_CHECK',
  /** Backfill: casa animes sem anilistId com AniList (título/slug) e grava
   * anilistId + year/season/format/episodeCount/studios */
  BACKFILL_ANILIST: 'BACKFILL_ANILIST',
  /** Deriva o horário fixo de exibição (dia da semana + hora) do airingSchedule
   *  e grava em AnimeSchedule — alimenta o calendário semanal */
  SYNC_SCHEDULES: 'SYNC_SCHEDULES',
} as const;

export type JobType = (typeof JOB_TYPE)[keyof typeof JOB_TYPE];

export const JOB_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** Prioridades (menor = mais urgente).
 *
 * Jobs de controle (CHECK_RELEASES, DISCOVER_SEASON, SYNC_AIRING, SYNC_SCHEDULES,
 * BACKFILL_ANILIST) ficam ACIMA
 * do backfill (EXTRACT/SCAN_CATALOG) para nunca serem famintos por uma fila
 * cheia de extrações de catálogo. Episódios NOVOS (ReleaseMonitor) usam
 * EXTRACT_NEW, que fura a fila de backfill (EXTRACT).
 */
export const PRIORITY = {
  /** Novo episódio de anime em lançamento — o mais urgente */
  CHECK_RELEASES: 40,
  REPAIR: 50,
  GAP_CHECK: 60,
  /** Extração de episódio NOVO vinda do ReleaseMonitor (fura o backfill) */
  EXTRACT_NEW: 80,
  VALIDATE: 90,
  EXTRACT: 100,
  SYNC_AIRING: 150,
  DISCOVER_SEASON: 160,
  /** Sync de horários de exibição (SYNC_SCHEDULES) — backfill leve, atrás de
   * descobertas e releases (episódios novos têm prioridade de fila). */
  SYNC_SCHEDULES: 170,
  /** Backfill de anilistId/metadados — ainda menos urgente (só enriquece catálogo). */
  BACKFILL_ANILIST: 180,
  SCAN_CATALOG: 280,
} as const;

/** Backoff exponencial: [15min, 1h, 6h, 24h, 48h]. */
export const BACKOFF_MS: number[] = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  48 * 60 * 60_000,
];

/** IDs de fonte canônicos (devem bater com ScrapeSource.id). */
export const SOURCE_IDS = [
  'meusanimes',
  'animefire',
  'animesonlinecc',
] as const;

/** Template de URL de episódio por fonte.
 *
 * Post-split: cada anime sibling tem slug que já codifica a temporada
 * (ex: "kaguya-sama-love-is-war-2"). O parâmetro `season` é mantido para
 * compatibilidade de assinatura mas NÃO é injetado no slug do meusanimes.
 */
export function sourceEpisodeUrl(
  sourceId: string,
  animeSlug: string,
  episodeNumber: number,
  _season: number = 1,
): string | null {
  switch (sourceId) {
    case 'meusanimes':
      return `https://meusanimes.blog/e/${animeSlug}-episodio-${episodeNumber}/`;
    case 'animefire':
      return `https://animefire.io/animes/${animeSlug}/${episodeNumber}`;
    case 'animesonlinecc':
      return `https://animesonlinecc.to/episodio/${animeSlug}-episodio-${episodeNumber}/`;
    default:
      return null;
  }
}

/** Helper: backoff p/ próxima tentativa. */
export function nextBackoffMs(attempts: number): number {
  return (
    BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ??
    BACKOFF_MS[BACKOFF_MS.length - 1]!
  );
}
