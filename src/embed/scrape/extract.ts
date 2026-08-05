import type { Page, Request } from 'playwright';

/** Hosts de stream que aparecem em requests de midia capturados. */
const MEDIA_HOST_RE =
  /googlevideo\.com\/videoplayback|\/videoplayback|\.m3u8|\.mp4|\.ts($|\?)|streamtape|mixdrop|doodstream|hydrax|blogger\.com\/video/i;

/** Filtra so URLs .mp4 / .m3u8 (descarta blob:, data:, etc.). */
export function keepVideoUrls(urls: string[]): string[] {
  return urls.filter(
    (u) => /\.mp4($|\?|#)/i.test(u) || /\.m3u8($|\?|#)/i.test(u),
  );
}

/**
 * Tipos minimos do DOM usados dentro do page.evaluate (contexto do browser).
 * O tsconfig nao inclui a lib "DOM"; estas interfaces tipam apenas o que a
 * extracao usa, sem recorrer a `any`.
 */
interface SourceElementLike {
  getAttribute(name: string): string | null;
}

interface NodeListLike<T> {
  forEach(callbackfn: (value: T) => void): void;
}

interface VideoElementLike extends SourceElementLike {
  readonly currentSrc: string;
  readonly src: string;
  querySelectorAll(selectors: string): NodeListLike<SourceElementLike>;
}

interface ExtractDocument {
  querySelectorAll(selectors: 'video'): NodeListLike<VideoElementLike>;
  querySelectorAll(selectors: 'source[src]'): NodeListLike<SourceElementLike>;
  querySelectorAll(selectors: 'iframe[src]'): NodeListLike<SourceElementLike>;
}

declare const document: ExtractDocument;

/**
 * Extrai URLs de video do DOM: video.js seta currentSrc (nao atributo src).
 * Pega currentSrc, src e <source src>. Dedupe.
 */
export async function extractVideoElements(page: Page): Promise<string[]> {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate(() => {
      const videos: string[] = [];
      document.querySelectorAll('video').forEach((v) => {
        const src = v.currentSrc || v.getAttribute('src') || v.src;
        if (src) videos.push(src);
        v.querySelectorAll('source[src]').forEach((s) => {
          const ss = s.getAttribute('src');
          if (ss) videos.push(ss);
        });
      });
      document.querySelectorAll('source[src]').forEach((s) => {
        const ss = s.getAttribute('src');
        if (ss) videos.push(ss);
      });
      return [...new Set(videos)];
    });
  } catch {
    return [];
  }
}

/** Extrai URLs de todos os iframes com src na pagina. */
export async function extractAllIframes(page: Page): Promise<string[]> {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('iframe[src]').forEach((el) => {
        const src = el.getAttribute('src');
        if (src) out.push(src);
      });
      return [...new Set(out)];
    });
  } catch {
    return [];
  }
}

/**
 * Tenta clicar no botao de play do player (BloggerVideo, video.js, Dooplay).
 * Muitos clones (meusanimes.blog, animesonlinecc.to) usam o player do Blogger
 * que so carrega o <video>/videoPlayback apos o click no placeholder estatico.
 * Clicar dispara a cadeia JS que gera a URL .mp4 (googlevideo.com/videoplayback).
 *
 * @returns true se algum elemento de play foi clicado.
 */
export async function triggerPlayButton(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;

  // Seletores de placeholder de play observados nos clones:
  // - Blogger: .html5-video-player .ytp-cued-thumbnail-overlay, [aria-label*="Play"]
  // - Dooplay: .play, .dooplay_player .play, [class*="play"]
  // - generico: img[src*="play_arrow"], div com play
  const playSelectors = [
    // Dooplay (meusanimes.blog): botoes reais observados no DOM.
    'a.play-pause',
    '.play-pause',
    '.player_sist',
    '.playex',
    '.play-box-iframe',
    // Blogger / YouTube embed.
    '.ytp-cued-thumbnail-overlay',
    '.ytp-large-play-button',
    '[aria-label*="Play" i]',
    '[aria-label*="Reproduzir" i]',
    '.dooplay_player .play',
    '.play-button',
    '.play',
    'img[src*="play_arrow"]',
    '.video-player [class*="play"]',
  ];

  for (const sel of playSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded().catch(() => undefined);
        await el.click({ timeout: 3000 }).catch(() => undefined);
        return true;
      }
    } catch {
      /* tentative selector */
    }
  }

  // Ultima tentativa no page principal: click direto no <video> ou iframe do
  // player (alguns clones iniciam com click no proprio container do video).
  try {
    const videoEl = await page.$('video, iframe[src*="blogger.com/video"]');
    if (videoEl) {
      await videoEl.click({ timeout: 3000 }).catch(() => undefined);
      return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

/**
 * Tenta clicar no botao de play DENTRO dos iframes (ex: player Blogger é
 * cross-origin, botao .ytp-large-play-button vive dentro do iframe, nao no
 * page principal). Percorre page.mainFrame().childFrames() e clica nos mesmos
 * seletores dentro de cada frame.
 *
 * @returns true se clicou em algum botao dentro de um iframe.
 */
export async function triggerPlayButtonInFrames(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;

  const playSelectorsInFrame = [
    '.ytp-cued-thumbnail-overlay',
    '.ytp-large-play-button',
    '[aria-label*="Play" i]',
    '[aria-label*="Reproduzir" i]',
    '.video-play-link',
  ];

  for (const frame of page.mainFrame().childFrames()) {
    for (const sel of playSelectorsInFrame) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await el.click({ timeout: 3000 }).catch(() => undefined);
          return true;
        }
      } catch {
        /* frame cross-origin pode rejeitar; ignora */
      }
    }
  }
  return false;
}

/**
 * Intercepta requests de midia (.mp4/.m3u8/videoplayback) durante N ms.
 * Retorna todas as URLs de stream capturadas. Usado apos triggerPlayButton
 * para pegar a URL real gerada dinamicamente pelo JS do player.
 *
 * @param page pagina carregada.
 * @param durationMs quanto tempo escuchar requests de midia.
 */
export async function captureMediaRequests(
  page: Page,
  durationMs = 8000,
): Promise<string[]> {
  if (page.isClosed()) return [];
  const captured: string[] = [];

  const handler = (req: Request) => {
    const url = req.url();
    if (MEDIA_HOST_RE.test(url)) captured.push(url);
  };
  page.on('request', handler);

  // Aguarda as requisições de stream acontecerem após o clique.
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    if (page.isClosed()) break;
    await page.waitForTimeout(250).catch(() => undefined);
  }
  page.off('request', handler);
  return [...new Set(captured)];
}

/**
 * Extracao generica multi-fonte: cobre os 3 padroes observados nos clones.
 *  1. <video>/<source> .mp4/.m3u8 diretos no DOM (animefire).
 *  2. iframe Blogger (blogger.com/video.g?token=) -> clicar play -> 3.
 *  3. request googlevideo.com/videoplayback gerado apos click (meusanimes etc).
 *
 * Tenta em ordem: DOM; se vazio, clica play e intercepta requests.
 *
 * @param preCaptured URLs de midia ja capturadas pelo listener antes do click
 *        (passadas pelo ScrapeService). Usa como fallback se nada for capturado.
 */
export async function extractEpisodeMedia(
  page: Page,
  preCaptured: string[] = [],
): Promise<{ videos: string[]; iframes: string[] }> {
  let videos = keepVideoUrls(await extractVideoElements(page));
  const iframes = await extractAllIframes(page);

  console.log(
    '[EXTRACT] videos-no-dom=',
    videos.length,
    'iframes=',
    iframes.length,
    iframes.slice(0, 3),
  );

  // Se ja tem .mp4/.m3u8 no DOM, nao precisa clicar (animefire).
  if (videos.length > 0) {
    return { videos, iframes };
  }

  // Requests de midia ja capturados no load (alguns clones disparam sozinhos).
  const preStream = preCaptured.filter(
    (u) => /\.mp4($|\?|#)/i.test(u) || /videoplayback/i.test(u),
  );
  if (preStream.length > 0) {
    console.log('[EXTRACT] stream capturado no load:', preStream.length);
    videos = preStream;
    const after = keepVideoUrls(await extractVideoElements(page));
    for (const v of after) if (!videos.includes(v)) videos.push(v);
    return { videos, iframes };
  }

  // Sem video no DOM: tenta clicar no play e interceptar stream (Blogger/Dooplay).
  let clicked = await triggerPlayButton(page);

  console.log('[EXTRACT] clique-no-play=', clicked);
  if (!clicked) {
    // Botao de play do Blogger vive dentro do iframe cross-origin — tenta la.
    clicked = await triggerPlayButtonInFrames(page);

    console.log('[EXTRACT] clique-no-iframe=', clicked);
  }
  if (clicked) {
    const captured = await captureMediaRequests(page, 10000);
    const streamUrls = captured.filter(
      (u) => /\.mp4($|\?|#)/i.test(u) || /videoplayback/i.test(u),
    );

    console.log(
      '[EXTRACT] capturados-pos-clique=',
      captured.length,
      JSON.stringify(captured.slice(0, 3)),
    );
    if (streamUrls.length > 0) {
      videos = streamUrls;
    }
    // Re-extrai <video> caso o click tenha injetado um novo elemento.
    const after = keepVideoUrls(await extractVideoElements(page));
    for (const v of after) {
      if (!videos.includes(v)) videos.push(v);
    }
  }

  return { videos, iframes };
}
