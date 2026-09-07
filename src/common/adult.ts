export const ADULT_GENRE_SLUG = 'hentai';
export const ADULT_AGE_RATING = 'A18';

export function shouldExcludeAdult(filters?: {
  includeHentai?: string;
}): boolean {
  if (process.env.SITE_MODE === 'hentai') return false;
  const opt =
    filters?.includeHentai === '1' || filters?.includeHentai === 'true';
  if (opt && process.env.ADULT_CATALOG_ENABLED === 'true') return false;
  return true;
}
