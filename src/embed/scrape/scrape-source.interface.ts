import type { Page } from 'playwright';
import type { AudioType } from '@prisma/client';

/** Resultado da extração de um episódio. */
export interface ScrapeEpisodeResult {
  /** URLs de video .mp4 ou .m3u8 (video.js currentSrc / source / scripts). */
  videos: string[];
  /** URLs dos iframes de player na pagina. */
  iframes: string[];
  /** Marcador de bloqueio Cloudflare (sempre false aqui — se true lanca excecao). */
  cloudflare: boolean;
  /**
   * URLs de player descobertas por HTTP que NÃO são streamáveis direto
   * (devolvem HTML/página de player): blogger.com/video.g?token=...,
   * youtube-nocookie.com/embed/<id> etc. Precisam do fluxo Playwright
   * (extractPlayerVideo) p/ virar .mp4 googlevideo.
   */
  playerTokens?: string[];
}

/** Contexto p/ extração HTTP pura (sem Playwright). */
export interface HttpExtractContext {
  /** URL absoluta da página do episódio. */
  episodeUrl: string;
  /** User-Agent desktop real (nao bot). */
  ua: string;
  /** Áudio esperado pelo anime; adapters podem rejeitar opções incompatíveis. */
  audio?: AudioType;
}

/** Contexto p/ resolução de URLs candidatas de um episódio numa fonte. */
export interface EpisodeUrlQuery {
  animeSlug: string;
  episodeNumber: number;
  season?: number;
  ua?: string;
}

/**
 * Adapter de extração por site. Cada fonte implementa seus seletores/extraction.
 * Reusa a infra Playwright — a pagina ja esta carregada quando extract() roda.
 *
 * AVISO DE IP-VINCULO (CRITICO, herda do animefire):
 *   Tokens .mp4 de CDNs pirates frequentemente VINCULAM ao IP. O IP que abriu
 *   a pagina (IP de saida do backend) deve ser o MESMO IP que consume o video.
 *   Localmente funciona; em prod com backend em host distinto do usuario,
 *   o CDN rejeita (403/expire). ESTUDO/AMBIENTE ISOLADO.
 */
export interface ScrapeSource {
  readonly id: string;
  /** true se este adapter sabe extrair desta URL. */
  supports(url: string): boolean;
  /**
   * URLs candidatas rápidas (baseadas em template de slug) sem I/O de rede.
   * Usado quando um consumidor quer apenas os templates (ex: fallback de embedUrl).
   */
  templateUrls?(query: EpisodeUrlQuery): string[];
  /**
   * Resolve as URLs candidatas da página do episódio nesta fonte em 2 passos:
   * 1) Variantes de slug na URL template;
   * 2) Fallback na listagem estática da página do anime quando o template falha.
   */
  resolveEpisodeUrls?(query: EpisodeUrlQuery): Promise<string[]>;
  /**
   * Extrai videos + iframes da pagina ja carregada (Playwright Page).
   * A deteção de Cloudflare e o carregamento sao responsabilidade do
   * ScrapeService — aqui so a extração especifica do site.
   */
  extract(page: Page): Promise<ScrapeEpisodeResult>;
  /**
   * Extração HTTP pura (sem navegador). Se presente, o ScrapeService pula o
   * Playwright e usa este caminho — relevante p/ fontes acessiveis por fetch
   * simples (animefire: data-video-src -> JSON). Devolve `videos` RAW (sem
   * wrap pelo proxy de midia); o ScrapeService cuida do wrap na resposta.
   */
  extractHttp?(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult>;
}
