/**
 * Parser do catálogo do topanimes.net (tema Dooplay/WordPress).
 *
 * A listagem de episódios é um `<ul class='episodios'>` com um `<li>` por
 * episódio: `<div class='numerando'>S - E</div>` + o link real em
 * `<div class='episodiotitle'><a href='...'>`. Os links usam ASPAS SIMPLES —
 * regex que só caseia aspas duplas devolve zero e faz a fonte parecer sem
 * episódios.
 *
 * Vive no catálogo (não no adapter de scrape): o CatalogScanner usa isto para
 * descobrir quantos episódios a fonte publica, e o seed usa para ler
 * metadados (título, poster, sinopse, gêneros) da página.
 */

export interface TopanimesEpisode {
  season: number;
  episode: number;
  url: string;
}

export interface TopanimesCatalog {
  /** Título original da obra (h1). */
  title: string | null;
  /** Poster (w500 do tmdb). */
  poster: string | null;
  /** Sinopse em pt-BR. */
  synopsis: string | null;
  /** Gêneros como o site escreve (pt-BR). */
  genres: string[];
  episodes: TopanimesEpisode[];
}

const LI_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const NUMERANDO_RE = /class=['"]numerando['"]>\s*(\d+)\s*-\s*(\d+)\s*</i;
const EPISODE_LINK_RE =
  /class=['"]episodiotitle['"][\s\S]*?<a\s+href=['"]([^'"]+)['"]/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const POSTER_RE = /class=['"]poster['"][^>]*>\s*<img[^>]+src=['"]([^'"]+)['"]/i;
const SYNOPSIS_RE =
  /<h2[^>]*>\s*Sinopse[\s\S]*?<\/h2>\s*<div[^>]*>\s*<p>([\s\S]*?)<\/p>/i;
const GENRES_RE = /class=['"]sgeneros['"][^>]*>([\s\S]*?)<\/div>/i;
const ANCHOR_TEXT_RE = /<a[^>]*>([^<]*)<\/a>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&(quot|apos|nbsp|lt|gt|amp);/g, (m, name: string) => {
      switch (name) {
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'nbsp':
          return ' ';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        default:
          return '&' + name + ';';
      }
    });
}

/** Lê metadados e episódios da página de catálogo `/animes/<slug>/`. */
export function parseTopanimesCatalog(html: string): TopanimesCatalog {
  const episodes: TopanimesEpisode[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(LI_RE)) {
    const block = match[1];
    if (!block) continue;
    const numbers = block.match(NUMERANDO_RE);
    const link = block.match(EPISODE_LINK_RE);
    if (!numbers || !link) continue;
    const season = Number(numbers[1]);
    const episode = Number(numbers[2]);
    const url = link[1]!.trim();
    if (!Number.isFinite(season) || !Number.isFinite(episode) || !url) continue;
    const key = `${season}:${episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    episodes.push({ season, episode, url });
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);

  const title = html.match(H1_RE);
  const poster = html.match(POSTER_RE);
  const synopsis = html.match(SYNOPSIS_RE);
  const genresBlock = html.match(GENRES_RE);
  const genres = genresBlock
    ? [...genresBlock[1]!.matchAll(ANCHOR_TEXT_RE)]
        .map((m) => decodeEntities(stripTags(m[1]!)))
        .filter(Boolean)
    : [];

  return {
    title: title ? decodeEntities(stripTags(title[1]!)) : null,
    poster: poster ? poster[1]!.trim() : null,
    synopsis: synopsis
      ? decodeEntities(stripTags(synopsis[1]!)).replace(/\s+/g, ' ').trim()
      : null,
    genres,
    episodes,
  };
}
