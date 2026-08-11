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

/** Prioridades (menor = mais urgente). */
export const PRIORITY = {
  REPAIR: 50,
  EXTRACT: 100,
  VALIDATE: 90,
  CHECK_RELEASES: 200,
  DISCOVER_SEASON: 300,
  SCAN_CATALOG: 280,
  SYNC_AIRING: 250,
  GAP_CHECK: 60,
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
