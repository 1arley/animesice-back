/* eslint-disable @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-argument,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-explicit-any --
  Playwright page.on()/evaluate() callback types are complex generics that
  ESLint cannot fully resolve; DOM types not in tsconfig lib. */
import type { Page, Request as PlaywrightRequest } from 'playwright';

const VIDEO_HOST_RE = /videoplayback|\.mp4($|\?|#)|\.m3u8($|\?|#)/i;

/** Subconjunto do DOM usado na verificação de readiness. */
interface CheckNodeList {
  length: number;
  forEach(callbackfn: (value: any) => void): void;
  [index: number]: any;
}

interface CheckDocument {
  querySelectorAll(selectors: string): CheckNodeList;
}

declare const document: CheckDocument;

/**
 * Aguarda o player ficar pronto usando detecção por eventos, substituindo
 * sleeps hardcoded. Estratégia:
 * 1. Espera curta (2s) para o JS do player inicializar
 * 2. Verifica se já tem <video> com currentSrc válido
 * 3. Verifica se requests de mídia já foram capturadas
 * 4. Se nada, espera por novas requests de mídia por até 8s
 * 5. Se nada, clica no play e aguarda por requests
 *
 * Retorna as URLs de mídia capturadas durante a espera.
 */
export async function waitForPlayerReady(
  page: Page,
  preCaptured: string[] = [],
): Promise<{ ready: boolean; mediaUrls: string[] }> {
  if (page.isClosed()) return { ready: false, mediaUrls: [] };

  const allMediaUrls = [...preCaptured];

  // Verifica rapidamente se o player já está pronto (video com src no DOM)
  const quickCheck = await checkVideoReady(page);
  if (quickCheck.ready) {
    return { ready: true, mediaUrls: [...allMediaUrls, ...quickCheck.urls] };
  }

  // Espera curta para o JS do player injetar o <video> ou iframe
  await page.waitForTimeout(2_000).catch(() => undefined);

  // Verifica novamente após a espera curta
  const afterShortWait = await checkVideoReady(page);
  if (afterShortWait.ready) {
    return {
      ready: true,
      mediaUrls: [...allMediaUrls, ...afterShortWait.urls],
    };
  }

  // Registra listener de requests de mídia antes de aguardar
  const mediaListener = (req: PlaywrightRequest) => {
    const u = req.url();
    if (VIDEO_HOST_RE.test(u)) allMediaUrls.push(u);
  };
  page.on('request', mediaListener);

  // Espera por requests de mídia (event-driven, polls a cada 500ms)
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (page.isClosed()) break;
    if (hasVideoMediaUrls(allMediaUrls)) break;

    // Verifica se um <video> apareceu com src
    const check = await checkVideoReady(page);
    if (check.ready) {
      allMediaUrls.push(...check.urls);
      break;
    }

    await page.waitForTimeout(500).catch(() => undefined);
  }

  page.off('request', mediaListener);

  // Se ainda sem mídia, tenta clicar no play
  if (!hasVideoMediaUrls(allMediaUrls)) {
    const clicked = await triggerPlaySmart(page);
    if (clicked) {
      // Registra listener novamente para capturar requests pós-clique
      const postClickListener = (req: PlaywrightRequest) => {
        const u = req.url();
        if (VIDEO_HOST_RE.test(u)) allMediaUrls.push(u);
      };
      page.on('request', postClickListener);

      const postDeadline = Date.now() + 6_000;
      while (Date.now() < postDeadline) {
        if (page.isClosed()) break;
        if (hasVideoMediaUrls(allMediaUrls)) break;
        await page.waitForTimeout(400).catch(() => undefined);
      }

      page.off('request', postClickListener);

      // Verifica DOM mais uma vez
      const finalCheck = await checkVideoReady(page);
      allMediaUrls.push(...finalCheck.urls);
    }
  }

  const unique = [...new Set(allMediaUrls)];
  return { ready: unique.length > 0, mediaUrls: unique };
}

/**
 * Verifica se há um <video> com currentSrc/src válido no DOM.
 */
async function checkVideoReady(
  page: Page,
): Promise<{ ready: boolean; urls: string[] }> {
  if (page.isClosed()) return { ready: false, urls: [] };
  try {
    const result = await page.evaluate(() => {
      const videos: string[] = [];
      const allVideos = document.querySelectorAll('video');
      for (let i = 0; i < allVideos.length; i++) {
        const v = allVideos[i];
        const src = v.currentSrc || v.getAttribute('src') || v.src;
        if (src && /^https?:\/\//i.test(src)) videos.push(src);
        const sources = v.querySelectorAll('source[src]');
        for (let j = 0; j < sources.length; j++) {
          const ss = sources[j].getAttribute('src');
          if (ss && /^https?:\/\//i.test(ss)) videos.push(ss);
        }
      }
      return videos;
    });
    const filtered = result.filter(
      (u) =>
        /\.mp4($|\?|#)/i.test(u) ||
        /\.m3u8($|\?|#)/i.test(u) ||
        /videoplayback/i.test(u),
    );
    return { ready: filtered.length > 0, urls: filtered };
  } catch {
    return { ready: false, urls: [] };
  }
}

function hasVideoMediaUrls(urls: string[]): boolean {
  return urls.some(
    (u) =>
      /\.mp4($|\?|#)/i.test(u) ||
      /videoplayback/i.test(u) ||
      /\.m3u8($|\?|#)/i.test(u),
  );
}

/**
 * Clica no botão de play de forma inteligente: tenta seletores comuns,
 * depois iframe, depois <video> direto.
 */
async function triggerPlaySmart(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;

  const selectors = [
    'a.play-pause',
    '.play-pause',
    '.player_sist',
    '.playex',
    '.play-box-iframe',
    '.ytp-cued-thumbnail-overlay',
    '.ytp-large-play-button',
    '[aria-label*="Play" i]',
    '[aria-label*="Reproduzir" i]',
    '.dooplay_player .play',
    '.play-button',
    '.play',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded().catch(() => undefined);
        await el.click({ timeout: 3000 }).catch(() => undefined);
        return true;
      }
    } catch {
      /* tentative */
    }
  }

  // Tenta nos iframes filhos
  for (const frame of page.mainFrame().childFrames()) {
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await el.click({ timeout: 3000 }).catch(() => undefined);
          return true;
        }
      } catch {
        /* cross-origin */
      }
    }
  }

  // Último recurso: click no <video> ou iframe do player
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
 * Resolve player token (Blogger/YouTube) de forma event-driven.
 * Substitui o sleep 8s + polling 15s por detecção de events mais agressiva.
 */
export async function extractPlayerVideoEventDriven(
  page: Page,
  playerTokenUrl: string,
): Promise<string[]> {
  const captured: string[] = [];

  page.on('request', (req) => {
    const u = req.url();
    if (/videoplayback|googlevideo|\.mp4($|\?|#)/i.test(u)) {
      captured.push(u);
    }
  });

  try {
    await page.goto(playerTokenUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Espera inicial reduzida: 3s (vs 8s original)
    await page.waitForTimeout(3_000);

    // Click no body para triggerar o player
    await page.click('body', { timeout: 3_000 }).catch(() => undefined);

    // Tenta botões de play
    const playSelectors = [
      '.ytp-cued-thumbnail-overlay',
      '.ytp-large-play-button',
      '[aria-label*="Play" i]',
      'button[aria-label*="Play" i]',
    ];
    for (const sel of playSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ timeout: 3_000 }).catch(() => undefined);
          break;
        }
      } catch {
        /* tentative */
      }
    }

    // Tenta nos iframes
    for (const frame of page.mainFrame().childFrames()) {
      for (const sel of playSelectors) {
        try {
          const el = await frame.$(sel);
          if (el) {
            await el.click({ timeout: 3_000 }).catch(() => undefined);
            break;
          }
        } catch {
          /* cross-origin */
        }
      }
    }

    // Espera por requests de videoplayback (polling reduzido: 4s vs 15s)
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if (page.isClosed()) break;
      if (captured.length > 0) break;
      await page.waitForTimeout(300).catch(() => undefined);
    }

    return [...new Set(captured)].filter((u) =>
      /videoplayback|\.mp4($|\?|#)/i.test(u),
    );
  } catch (err) {
    console.error(
      '[PLAYER-EVENT] erro:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  } finally {
    await page.close().catch(() => undefined);
  }
}
