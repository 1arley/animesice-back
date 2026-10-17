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
 * Releases e sincronizações ficam à frente do backfill. Reparos antigos rodam
 * depois de extrações e scans, sem impedir a fila de recuperar a cobertura.
 */
export const PRIORITY = {
  /** Novo episódio de anime em lançamento — o mais urgente */
  CHECK_RELEASES: 40,
  /** Reparos antigos ficam atrás de releases, extrações e descoberta de catálogo. */
  REPAIR: 130,
  GAP_CHECK: 60,
  /** Extração de episódio NOVO vinda do ReleaseMonitor. */
  DISCOVER_SEASON: 65,
  SYNC_AIRING: 70,
  EXTRACT_NEW: 80,
  VALIDATE: 90,
  EXTRACT: 100,
  /** Backfill de redundância fica atrás das extrações normais. */
  SOURCE_BACKFILL: 105,
  /** Sync de horários de exibição (SYNC_SCHEDULES) — backfill leve, atrás de
   * descobertas e releases (episódios novos têm prioridade de fila). */
  SYNC_SCHEDULES: 120,
  /** Backfill de anilistId/metadados — ainda menos urgente (só enriquece catálogo). */
  BACKFILL_ANILIST: 180,
  /** SCAN_CATALOG de anime em lançamento ou com catálogo mapeado.
   *  Fura a fila de backfill: é o único caminho pra DESCOBRIR episódio novo
   *  (catálogo mapeado não tem template de URL por slug), e atrás de
   *  EXTRACT/REPAIR o anime em lançamento fica semanas sem episódio.
   *  Custo: 1 GET por anime. */
  SCAN_CATALOG: 75,
} as const;

/* ---------------------------------------------------------------------------
 * TEMPORÁRIO — backfill prioritário manual.
 * Slugs-base das franquias: casa o anime exato e todas as temporadas-irmãs
 * (slug-2, slug-3, ...) e versões dubladas. Usado p/ forçar a colocação de
 * TODOS os episódios desses animes antes do resto da fila.
 * Quando a lista estiver zerada, o fluxo volta ao normal sem outra mudança.
 * ------------------------------------------------------------------------- */
export const PRIORITY_SLUGS: string[] = [
  'kaguya-sama-love-is-war',
  'kaguya-sama-wa-kokurasetai-otona-e-no-kaidan',
  'mushoku-tensei-isekai-ittara-honki-dasu',
  'mushoku-tensei-iii-isekai-ittara-honki-dasu',
];

/** Prioridade urgente p/ jobs desses slugs (acima de todo backfill, mas
 * abaixo do CHECK_RELEASES de controle p/ não famintar releases novos). */
export const PRIORITY_BOOST = 45;

/** true se o slug pertence a um anime da lista prioritária (ou sibling/dublado). */
export function isBoostedSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const s = slug.toLowerCase();
  return PRIORITY_SLUGS.some((base) => {
    const b = base.toLowerCase();
    return s === b || s.startsWith(`${b}-`);
  });
}

/** Prioridade efetiva p/ o enqueue: boostada se o slug for da lista. */
export function priorityForSlug(
  slug: string | null | undefined,
  basePriority: number,
): number {
  return isBoostedSlug(slug)
    ? Math.min(basePriority, PRIORITY_BOOST)
    : basePriority;
}

/** Backoff exponencial: [15min, 1h, 6h, 24h, 48h]. */
export const BACKOFF_MS: number[] = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  48 * 60 * 60_000,
];

/** IDs de fonte canônicos (devem bater com ScrapeSource.id). */
export const SOURCE_IDS = ['meusanimes', 'animesonline'] as const;

export const OPTIONAL_SOURCE_IDS = [
  'animesdigital',
  'topanimes',
  'animesorion',
] as const;

export function extractJobKey(
  animeId: string,
  season: number,
  episodeNumber: number,
): string {
  return `extract:${animeId}:${season}:${episodeNumber}`;
}

/** Template de URL de episódio por fonte. */
export function sourceEpisodeUrl(
  sourceId: string,
  animeSlug: string,
  episodeNumber: number,
  _season: number = 1,
): string | null {
  const template = SOURCE_URL_TEMPLATES[sourceId];
  return template ? template(animeSlug, episodeNumber, _season) : null;
}

/**
 * Variações de slug que as fontes usam para o MESMO anime.
 *
 * Nosso slug carrega áudio e temporada (`bleach-dublado-2`), mas os sites
 * indexam pelo nome do anime (`bleach`). Medido em 13/10/2026 na VPS: das 17
 * URLs de dublado testadas, 6 respondiam com o sufixo e 12 sem — e para
 * `bleach-dublado-2`/`dr-stone-dublado-4` só a forma sem sufixo existe.
 * Sem isso o probe 404 descarta a fonte inteira.
 *
 * Ordem = mais específica -> mais genérica (o chamador usa a 1ª que existir).
 */
export function slugVariants(animeSlug: string): string[] {
  const variants = [
    animeSlug,
    animeSlug.replace(/-(?:dublado|legendado)(?:-\d+)?$/i, ''),
  ];
  return variants.filter((slug, i, all) => !!slug && all.indexOf(slug) === i);
}

/**
 * Todas as URLs candidatas de um episódio numa fonte, na ordem de preferência.
 * Variantes de slug x formato de URL da fonte.
 */
export function sourceEpisodeUrlVariants(
  sourceId: string,
  animeSlug: string,
  episodeNumber: number,
  season: number = 1,
): string[] {
  const template = SOURCE_URL_TEMPLATES[sourceId];
  if (!template) return [];
  return slugVariants(animeSlug).map((slug) =>
    template(slug, episodeNumber, season),
  );
}

/** Formato de URL de cada fonte: (slug, episodio, season) -> URL. */
const SOURCE_URL_TEMPLATES: Record<
  string,
  (slug: string, ep: number, season: number) => string
> = {
  meusanimes: (slug, ep) => `https://meusanimes.blog/e/${slug}-episodio-${ep}/`,
  animesonlinecc: (slug, ep) =>
    `https://animesonlinecc.to/episodio/${slug}-episodio-${ep}/`,
  animesonline: (slug, ep) =>
    `https://animesonline.cloud/episodio/${slug}-episodio-${ep}`,
  topanimes: (slug, ep) =>
    `https://topanimes.net/episodio/${slug}-episodio-${ep}/`,
  // Formato NxM (Kitsune): animesorion.cc e animexhd.xyz usam este.
  animesorion: (slug, ep, season) =>
    `https://animesorion.cc/episodios/${slug}-${season}x${ep}/`,
  animexhd: (slug, ep, season) =>
    `https://animexhd.xyz/episodios/${slug}-${season}x${ep}/`,
};

/** Helper: backoff p/ próxima tentativa. */
export function nextBackoffMs(attempts: number): number {
  return (
    BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ??
    BACKOFF_MS[BACKOFF_MS.length - 1]!
  );
}
