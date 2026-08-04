// src/embed/animefire-scrape.service.ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';

/**
 * UA desktop real (nao bot conhecido) para simulacao de navegador humano.
 * Cloudflare bloqueia user-agents de bot; se detectar "Just a moment", aborta sem bypass.
 */
const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Marcadores de tela de desafio do Cloudflare no <title>. */
const CLOUDFLARE_MARKERS = ['just a moment', 'checking your browser'];

/** Resultado da extracao de um episodio. */
export interface ScrapeEpisodeResult {
  /** URLs de video .mp4 ou .m3u8 (video.js currentSrc / source / scripts). */
  videos: string[];
  /** URLs dos iframes de player na pagina. */
  iframes: string[];
  /** Marcador de bloqueio Cloudflare (sempre false aqui — se true lanca excecao). */
  cloudflare: boolean;
}

/**
 * AnimefireScrapeService — extracao tecnica de URL .mp4/.m3u8 de episodio do animefire.io
 * via Playwright (chromium headless), modo alternativo ao iframe do player.
 *
 * Reusa a logica do `scrape_animefire/scrape.js` em TypeScript/Nest.
 *
 * AVISO DE IP-VINCULO (CRITICO):
 * --------------------------------
 * O token .mp4 gerado pelo animefire VINCULA o IP. O IP que abriu a pagina
 * (aqui, o IP de saida do backend Nest) deve ser o MESMO IP que consome o video
 * (o IP do usuario/navegador). No cenario local (scraper e usuario na mesma
 * maquina/rede, ex.: dev local), funciona. Em producao com backend em host
 * distinto do usuario, o token rejeitado pelo CDN do animefire (403/expire),
 * pois o IP do scraper != IP do espectador.
 *
 * NAO contorna Cloudflare bot-detection (sem stealth/patches). Se bloqueado,
 * lanca ServiceUnavailableException.
 *
 * ESTUDO/AMBIENTE ISOLADO: nao redistribui o conteudo extraido.
 */
@Injectable()
export class AnimefireScrapeService {
  /**
   * Abre a pagina de um episodio no chromium headless e extrai as URLs de video.
   * @param episodeUrl URL absoluta do episodio em animefire.io
   * @returns { videos, iframes, cloudflare }
   */
  async scrapeEpisodeVideo(
    episodeUrl: string,
  ): Promise<ScrapeEpisodeResult> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: UA_DESKTOP,
      locale: 'pt-BR',
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    try {
      await page.goto(episodeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      // Cloudflare: detecta tela de desafio e aborta (sem bypass).
      if (await this.detectCloudflare(page)) {
        throw new ServiceUnavailableException(
          'Cloudflare bloqueou a página do episódio (não contornamos bot-detection).',
        );
      }

      // Aguarda player/iframe/video aparecer.
      await this.waitPlayer(page);
      // Player video.js e injetado via JS apos DOM; espera extra p/ currentSrc popular.
      await page.waitForTimeout(6000);

      const videos = await this.extractVideos(page);
      const iframes = await this.extractIframes(page);

      // Mantem so .mp4/.m3u8 ((descarta outras currentSrc como blob:).
      const filtered = videos.filter(
        (u) => /\.mp4($|\?|#)/i.test(u) || /\.m3u8($|\?|#)/i.test(u),
      );

      return { videos: filtered, iframes, cloudflare: false };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  /** Detecta tela de desafio Cloudflare pelo <title>. */
  private async detectCloudflare(page: import('playwright').Page): Promise<boolean> {
    const title = (await page.title().catch(() => '')).toLowerCase();
    return CLOUDFLARE_MARKERS.some((m) => title.includes(m));
  }

  /** Aguardaplayer/iframe/video/video-player/[data-video] anexado. */
  private async waitPlayer(page: import('playwright').Page): Promise<void> {
    const selectors = [
      'iframe[src*="player"]',
      'video',
      '.video-player',
      '[data-video]',
    ].join(', ');
    try {
      await page.waitForSelector(selectors, { timeout: 25000, state: 'attached' });
    } catch {
      try {
        await page.waitForSelector(selectors, { timeout: 5000, state: 'visible' });
      } catch {
        // ignora: extraimos mesmo assim o que existir
      }
    }
  }

  /**
   * Extrai URLs de video: video.js seta currentSrc (nao atributo src).
   * Pega currentSrc, src e <source src>. Dedupe.
   */
  private async extractVideos(page: import('playwright').Page): Promise<string[]> {
    // page.evaluate roda no DOM do browser (com `document`); TS compila em
    // contexto Node (lib sem dom), por isso o callback e tipado como any.
    return await page.evaluate(() => {
      const videos: string[] = [];
      (globalThis as any).document.querySelectorAll('video').forEach((v: any) => {
        const src = v.currentSrc || v.getAttribute('src') || v.src;
        if (src) videos.push(src);
        v.querySelectorAll('source[src]').forEach((s: any) => {
          const ss = s.getAttribute('src');
          if (ss) videos.push(ss);
        });
      });
      (globalThis as any).document.querySelectorAll('source[src]').forEach((s: any) => {
        const ss = s.getAttribute('src');
        if (ss) videos.push(ss);
      });
      return [...new Set(videos)];
    });
  }

  /** Extrai URLs de todos os iframes na pagina. */
  private async extractIframes(page: import('playwright').Page): Promise<string[]> {
    return await page.evaluate(() => {
      const out: string[] = [];
      (globalThis as any).document.querySelectorAll('iframe[src]').forEach((el: any) => {
        const src = el.getAttribute('src');
        if (src) out.push(src);
      });
      return out;
    });
  }
}
