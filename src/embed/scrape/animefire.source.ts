import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { spawn } from 'node:child_process';
import { fetchSafeRaw } from '@/common/ssrf';
import {
  ScrapeSource,
  ScrapeEpisodeResult,
  HttpExtractContext,
} from './scrape-source.interface';
import {
  keepVideoUrls,
  isNoVideoUrl,
  extractVideoElements,
  extractAllIframes,
} from './extract';

/**
 * Origem do site fonte, injetada como Referer/Origin na chamada à CDN interna
 * /video (anti-hotlinking + obriga o JSON a resolver).
 */
const ANIMEFIRE_ORIGIN = 'https://animefire.io';

/** Regex p/ extrair o atributo data-video-src (URL interna /video/...). */
const DATA_VIDEO_SRC_RE = /data-video-src=["']([^"']+)["']/i;

/** Timeout de cada fetch HTTP puro (anti-travar em host lento). */
const FETCH_TIMEOUT_MS = 15_000;

/** Teto de bytes lidos de uma resposta (anti-memória). */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
interface RustScrapeResult {
  videos: string[];
  iframes: string[];
  cloudflare: boolean;
}

function runRustScraper(
  binary: string,
  ctx: HttpExtractContext,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(
      () => {
        child.kill('SIGKILL');
        reject(new Error('Timeout no scraper Rust.'));
      },
      FETCH_TIMEOUT_MS * 2 + 2_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        child.kill('SIGKILL');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (size > MAX_RESPONSE_BYTES) {
        reject(new Error('Saída do scraper Rust excedeu o limite permitido.'));
      } else if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').slice(0, 500)));
      } else {
        resolve(Buffer.concat(stdout).toString('utf8'));
      }
    });
    child.stdin.end(JSON.stringify(ctx));
  });
}

async function fetchBoundedSafe(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; dispatcher: import('undici').Dispatcher }> {
  return fetchSafeRaw(url, init, FETCH_TIMEOUT_MS);
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    throw new Error('Resposta maior que o limite permitido.');
  }

  if (!res.body) return await res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = (await reader.read()) as {
      done: boolean;
      value?: Uint8Array;
    };
    const { done, value } = result;
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Resposta maior que o limite permitido.');
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Adapter animefire.io.
 *
 * Caminho HTTP puro (extractHttp): porta o método `data-video-src` do GoAnime
 * (internal/scraper/providers/animefire/client.go GetEpisodeStreamURL):
 *   1. GET /animes/<slug>/<ep> -> HTML contém data-video-src=".../video/<slug>?...".
 *   2. GET /video/<slug>?...  (com Referer/Origin animefire.io) -> JSON
 *      { data:[{ src:"https://lightspeedst.net/.../hd/1.mp4?token=...&ip=...",
 *               label:"720p" }, ...] }.
 *   3. src vem com escapes \/ (unescape).
 * Sem Cloudflare (validado); sem Playwright; devolve RAW.
 *
 * Caminho Playwright (extract): fallback inerte — video.js currentSrc/<source>.
 */
@Injectable()
export class AnimefireScrapeSource implements ScrapeSource {
  readonly id = 'animefire';

  supports(url: string): boolean {
    return /animefire\./i.test(url);
  }

  /**
   * Extração HTTP pura. Devolve `videos` RAW (URLs .mp4 da CDN lightspeedst.net,
   * token IP-bound ao IP de saida do backend — resolvido em stream pelo proxy
   * de midia, ver EmbedService.proxyMedia).
   */
  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    const rustBinary = process.env.ANIMEFIRE_RUST_BIN;
    if (rustBinary) {
      const rustStartedAt = performance.now();
      let result: RustScrapeResult;
      try {
        const stdout = await runRustScraper(rustBinary, ctx);
        result = JSON.parse(stdout) as RustScrapeResult;
        if (
          !Array.isArray(result.videos) ||
          !result.videos.every((video) => typeof video === 'string') ||
          !Array.isArray(result.iframes) ||
          !result.iframes.every((iframe) => typeof iframe === 'string') ||
          typeof result.cloudflare !== 'boolean'
        ) {
          throw new Error('Saída inválida do scraper Rust.');
        }
        if (
          process.env.ANIMEFIRE_RUST_MODE !== 'shadow' &&
          !result.videos.length
        ) {
          throw new Error('Scraper Rust retornou zero vídeos.');
        }
      } catch (error) {
        console.warn(
          `[AF] scraper Rust falhou; usando Node: ${error instanceof Error ? error.message : String(error)}`,
        );
        return this.extractHttpNode(ctx);
      }
      if (process.env.ANIMEFIRE_RUST_MODE === 'shadow') {
        const rustMs = Math.round(performance.now() - rustStartedAt);
        const nodeStartedAt = performance.now();
        const nodeResult = await this.extractHttpNode(ctx);
        console.info(
          `[AF] shadow rustMs=${rustMs} nodeMs=${Math.round(performance.now() - nodeStartedAt)} rustVideos=${result.videos.length} nodeVideos=${nodeResult.videos.length} sameVideoCount=${result.videos.length === nodeResult.videos.length}`,
        );
        return nodeResult;
      }
      return result;
    }

    return this.extractHttpNode(ctx);
  }

  private async extractHttpNode(
    ctx: HttpExtractContext,
  ): Promise<ScrapeEpisodeResult> {
    // Step 1: página do episódio -> data-video-src.
    const { response: pageRes, dispatcher: pageDispatcher } =
      await fetchBoundedSafe(ctx.episodeUrl, {
        headers: {
          'user-agent': ctx.ua,
          'accept-language': 'pt-BR,pt;q=0.9',
          accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

    console.log(
      `[AF] extractHttp url='${ctx.episodeUrl}' status=${pageRes.status} final='${pageRes.url}'`,
    );
    let html: string;
    try {
      if (!pageRes.ok) {
        throw new Error(
          `animefire: página do episódio retornou ${pageRes.status} para url='${ctx.episodeUrl}' final='${pageRes.url}'`,
        );
      }
      html = await readBounded(pageRes, MAX_RESPONSE_BYTES);
    } finally {
      await pageDispatcher.close();
    }

    const m = html.match(DATA_VIDEO_SRC_RE);
    if (!m || !m[1]) {
      throw new Error('animefire: data-video-src não encontrado no HTML.');
    }
    const videoPageUrl = m[1];

    // Step 2: página interna /video -> JSON de fontes.
    const { response: videoRes, dispatcher: videoDispatcher } =
      await fetchBoundedSafe(videoPageUrl, {
        headers: {
          'user-agent': ctx.ua,
          referer: `${ANIMEFIRE_ORIGIN}/`,
          origin: ANIMEFIRE_ORIGIN,
          accept: 'application/json, text/plain, */*',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'follow',
      });
    let json: { data?: Array<{ src?: string; label?: string }> };
    try {
      if (!videoRes.ok) {
        throw new Error(`animefire: /video retornou ${videoRes.status}`);
      }
      json = JSON.parse(await readBounded(videoRes, MAX_RESPONSE_BYTES)) as {
        data?: Array<{ src?: string; label?: string }>;
      };
    } finally {
      await videoDispatcher.close();
    }

    if (!json.data || json.data.length === 0) {
      throw new Error('animefire: JSON de fontes vazio.');
    }

    // Unescape \/ e ordena por qualidade (hd/720p primeiro, depois sd).
    const srcs = json.data
      .map((d) => (d.src || '').replace(/\\\//g, '/'))
      .filter(
        (s) =>
          /^https?:\/\//i.test(s) &&
          !isNoVideoUrl(s) &&
          /\.mp4($|\?|#)/i.test(s),
      );

    // Preferência: hd (720p) primeiro. Mantém ordem original se não houver hd.
    const hd = srcs.find((s) => /\/hd\//i.test(s));
    const ordered = hd ? [hd, ...srcs.filter((s) => s !== hd)] : srcs;

    return { videos: [...new Set(ordered)], iframes: [], cloudflare: false };
  }

  /** Fallback Playwright (inerte em prod — animefire usa extractHttp). */
  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const all = await extractVideoElements(page);
    const iframes = await extractAllIframes(page);
    return { videos: keepVideoUrls(all), iframes, cloudflare: false };
  }
}
