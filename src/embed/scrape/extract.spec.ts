import {
  keepVideoUrls,
  isExpiringMediaUrl,
  preferPermanentMediaUrls,
  youtubeVideoId,
  youtubeEmbedUrl,
  extractVideoElements,
  extractAllIframes,
  triggerPlayButton,
  triggerPlayButtonInFrames,
  captureMediaRequests,
  extractEpisodeMedia,
} from '@/embed/scrape/extract';

describe('extract helpers', () => {
  describe('isExpiringMediaUrl', () => {
    it('detecta assinatura S3 temporária', () => {
      expect(
        isExpiringMediaUrl(
          'https://cdn/v.mp4?X-Amz-Date=20260728T160632Z&X-Amz-Expires=10800',
        ),
      ).toBe(true);
      expect(
        isExpiringMediaUrl(
          'https://cdn/v.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256',
        ),
      ).toBe(true);
    });

    it('detecta googlevideo expire', () => {
      expect(
        isExpiringMediaUrl(
          'https://rr.test.googlevideo.com/v?expire=1700000000',
        ),
      ).toBe(true);
    });

    it('não marca URLs permanentes (R2/arquivo público)', () => {
      expect(isExpiringMediaUrl('https://pub-x.r2.dev/Leg.mp4')).toBe(false);
      expect(isExpiringMediaUrl('https://cdn/v.mp4?quality=high')).toBe(false);
    });
  });

  describe('preferPermanentMediaUrls', () => {
    it('coloca URL permanente antes de token S3 expirado', () => {
      const expiring =
        'https://hugh.cdn.rumble.cloud/v.mp4?X-Amz-Date=20260728T160632Z&X-Amz-Expires=10800';
      const permanent = 'https://pub-c7f4.r2.dev/Leg.mp4';
      const result = preferPermanentMediaUrls([expiring, permanent]);
      expect(result[0]).toBe(permanent);
      expect(result[1]).toBe(expiring);
    });

    it('mantém ordem quando tudo é permanente', () => {
      const a = 'https://cdn1/v1.mp4';
      const b = 'https://cdn2/v2.mp4';
      expect(preferPermanentMediaUrls([a, b])).toEqual([a, b]);
    });

    it('mantém ordem quando tudo expira', () => {
      const a = 'https://cdn1/v1.mp4?X-Amz-Expires=100';
      const b = 'https://cdn2/v2.mp4?expire=100';
      expect(preferPermanentMediaUrls([a, b])).toEqual([a, b]);
    });
  });

  describe('keepVideoUrls', () => {
    it('filtra apenas .mp4/.m3u8', () => {
      expect(
        keepVideoUrls(['https://cdn/v.mp4', 'blob:xyz', 'https://cdn/v.m3u8']),
      ).toEqual(['https://cdn/v.mp4', 'https://cdn/v.m3u8']);
    });
  });

  describe('youtubeVideoId', () => {
    it('extrai id de youtube-nocookie.com/embed (retorno do get-video.php)', () => {
      expect(
        youtubeVideoId(
          'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1&playsinline=1',
        ),
      ).toBe('0YpXN40vIxM');
    });

    it('extrai id de youtube.com/embed e watch', () => {
      expect(youtubeVideoId('https://www.youtube.com/embed/abcDEFghi12')).toBe(
        'abcDEFghi12',
      );
      expect(
        youtubeVideoId('https://www.youtube.com/watch?v=0YpXN40vIxM&t=10s'),
      ).toBe('0YpXN40vIxM');
    });

    it('extrai id de youtu.be', () => {
      expect(youtubeVideoId('https://youtu.be/0YpXN40vIxM')).toBe(
        '0YpXN40vIxM',
      );
    });

    it('retorna null p/ URLs não-YouTube', () => {
      expect(youtubeVideoId('https://www.blogger.com/video.g?token=x')).toBe(
        null,
      );
      expect(youtubeVideoId('https://cdn/v.mp4')).toBe(null);
    });
  });

  describe('youtubeEmbedUrl', () => {
    it('converte watch/embed/shorts/youtu.be em embed reproduzível', () => {
      expect(
        youtubeEmbedUrl('https://www.youtube.com/watch?v=0YpXN40vIxM'),
      ).toBe('https://www.youtube-nocookie.com/embed/0YpXN40vIxM');
      expect(
        youtubeEmbedUrl(
          'https://www.youtube-nocookie.com/embed/0YpXN40vIxM?autoplay=1&playsinline=1',
        ),
      ).toBe('https://www.youtube-nocookie.com/embed/0YpXN40vIxM');
      expect(youtubeEmbedUrl('https://youtu.be/abcDEFghi12')).toBe(
        'https://www.youtube-nocookie.com/embed/abcDEFghi12',
      );
    });

    it('retorna null p/ URLs não-YouTube', () => {
      expect(youtubeEmbedUrl('https://www.blogger.com/video.g?token=x')).toBe(
        null,
      );
      expect(youtubeEmbedUrl('https://cdn/v.mp4')).toBe(null);
    });
  });

  describe('extractVideoElements', () => {
    it('retorna [] quando a página está fechada', async () => {
      const page = { isClosed: jest.fn(() => true) } as any;
      expect(await extractVideoElements(page)).toEqual([]);
    });

    it('deduplica URLs de video do DOM', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => [
          ...new Set(['a.mp4', 'a.mp4', 'b.m3u8']),
        ]),
      } as any;
      expect(await extractVideoElements(page)).toEqual(['a.mp4', 'b.m3u8']);
    });

    it('retorna [] quando evaluate lança erro', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => {
          throw new Error('boom');
        }),
      } as any;
      expect(await extractVideoElements(page)).toEqual([]);
    });
  });

  describe('extractAllIframes', () => {
    it('retorna [] quando a página está fechada', async () => {
      const page = { isClosed: jest.fn(() => true) } as any;
      expect(await extractAllIframes(page)).toEqual([]);
    });

    it('deduplica URLs de iframe', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => [
          ...new Set([
            'https://a.test/f1',
            'https://a.test/f1',
            'https://b.test/f2',
          ]),
        ]),
      } as any;
      expect(await extractAllIframes(page)).toEqual([
        'https://a.test/f1',
        'https://b.test/f2',
      ]);
    });

    it('retorna [] quando evaluate lança erro', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => {
          throw new Error('boom');
        }),
      } as any;
      expect(await extractAllIframes(page)).toEqual([]);
    });
  });

  describe('triggerPlayButton', () => {
    it('retorna false quando a página está fechada', async () => {
      const page = { isClosed: jest.fn(() => true) } as any;
      expect(await triggerPlayButton(page)).toBe(false);
    });

    it('clica no primeiro seletor de play encontrado', async () => {
      const el = {
        scrollIntoViewIfNeeded: jest.fn(async () => undefined),
        click: jest.fn(async () => undefined),
      };
      let call = 0;
      const page = {
        isClosed: jest.fn(() => false),
        $: jest.fn(async () => {
          call++;
          return call === 1 ? el : null;
        }),
      } as any;
      expect(await triggerPlayButton(page)).toBe(true);
      expect(el.click).toHaveBeenCalledWith({ timeout: 3000 });
    });

    it('usa fallback de video/iframe quando nenhum seletor de play existe', async () => {
      const el = {
        click: jest.fn(async () => undefined),
      };
      const page = {
        isClosed: jest.fn(() => false),
        $: jest.fn(async (sel: string) => (sel.includes('video') ? el : null)),
      } as any;
      expect(await triggerPlayButton(page)).toBe(true);
    });

    it('retorna true mesmo quando o clique falha', async () => {
      const el = {
        scrollIntoViewIfNeeded: jest.fn(async () => {
          throw new Error('nope');
        }),
        click: jest.fn(async () => undefined),
      };
      const page = {
        isClosed: jest.fn(() => false),
        $: jest.fn(async () => el),
      } as any;
      expect(await triggerPlayButton(page)).toBe(true);
    });

    it('retorna false quando não há botão de play', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        $: jest.fn(async () => null),
      } as any;
      expect(await triggerPlayButton(page)).toBe(false);
    });
  });

  describe('triggerPlayButtonInFrames', () => {
    it('retorna false quando a página está fechada', async () => {
      const page = { isClosed: jest.fn(() => true) } as any;
      expect(await triggerPlayButtonInFrames(page)).toBe(false);
    });

    it('clica no play dentro de child frames', async () => {
      const el = {
        click: jest.fn(async () => undefined),
      };
      const frame = { $: jest.fn(async () => el) };
      const page = {
        isClosed: jest.fn(() => false),
        mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => [frame]) })),
      } as any;
      expect(await triggerPlayButtonInFrames(page)).toBe(true);
      expect(el.click).toHaveBeenCalled();
    });

    it('retorna false quando frames não têm botão de play', async () => {
      const frame = { $: jest.fn(async () => null) };
      const page = {
        isClosed: jest.fn(() => false),
        mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => [frame]) })),
      } as any;
      expect(await triggerPlayButtonInFrames(page)).toBe(false);
    });
  });

  describe('captureMediaRequests', () => {
    it('retorna [] quando a página está fechada', async () => {
      const page = { isClosed: jest.fn(() => true) } as any;
      expect(await captureMediaRequests(page, 10)).toEqual([]);
    });

    it('captura e deduplica requests de mídia', async () => {
      const handlers: Array<(req: any) => void> = [];
      const page = {
        isClosed: jest.fn(() => false),
        on: jest.fn((event: string, cb: any) => {
          handlers.push(cb);
        }),
        off: jest.fn(),
        waitForTimeout: jest.fn(async () => undefined),
      } as any;

      const promise = captureMediaRequests(page, 5);
      for (const h of handlers) {
        h({ url: () => 'https://cdn.test/video.mp4' });
        h({ url: () => 'https://cdn.test/video.m3u8' });
        h({ url: () => 'https://cdn.test/video.mp4' });
        h({ url: () => 'https://cdn.test/not-media.html' });
      }
      const result = await promise;
      expect(result).toEqual([
        'https://cdn.test/video.mp4',
        'https://cdn.test/video.m3u8',
      ]);
      expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
    });
  });

  describe('extractEpisodeMedia', () => {
    it('retorna vídeos do DOM quando existem, sem clicar', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => ['https://cdn/v.mp4']),
        on: jest.fn(),
        off: jest.fn(),
        waitForTimeout: jest.fn(),
        $: jest.fn(),
        mainFrame: jest.fn(),
      } as any;

      const result = await extractEpisodeMedia(page);
      expect(result.videos).toEqual(['https://cdn/v.mp4']);
    });

    it('usa preCaptured quando DOM está vazio', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => []),
        on: jest.fn(),
        off: jest.fn(),
        waitForTimeout: jest.fn(),
        $: jest.fn(),
        mainFrame: jest.fn(),
      } as any;

      const result = await extractEpisodeMedia(page, [
        'https://cdn.test/pre.mp4?token=x',
        'https://cdn.test/not-media',
      ]);
      expect(result.videos).toEqual(['https://cdn.test/pre.mp4?token=x']);
    });

    it('clica no play e usa streams capturados', async () => {
      const page = {
        isClosed: jest.fn(() => false),
        evaluate: jest.fn(async () => []),
        on: jest.fn(),
        off: jest.fn(),
        waitForTimeout: jest.fn(async () => undefined),
        $: jest.fn(async () => null),
        mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => []) })),
      } as any;

      // Captura handler de request registrado por captureMediaRequests.
      const handlers: Array<(req: any) => void> = [];
      page.on.mockImplementation((event: string, cb: any) => {
        handlers.push(cb);
      });

      const result = await extractEpisodeMedia(page);
      expect(result.videos).toEqual([]);
    });
  });
});

describe('extract helpers (DOM real via evaluate)', () => {
  function evaluateWithDocument(doc: Record<string, any>) {
    return jest.fn(async (fn: (...args: unknown[]) => unknown) => {
      const prev = (globalThis as any).document;
      (globalThis as any).document = doc;
      try {
        return await fn();
      } finally {
        (globalThis as any).document = prev;
      }
    });
  }

  function makeDoc(
    videos: any[] = [],
    sources: any[] = [],
    iframes: any[] = [],
  ) {
    return {
      querySelectorAll: (sel: string) => {
        if (sel === 'video') return videos;
        if (sel === 'source[src]') return sources;
        if (sel === 'iframe[src]') return iframes;
        return [];
      },
    };
  }

  it('coleta currentSrc, src e <source> com dedupe (DOM real)', async () => {
    const video = {
      currentSrc: 'https://cdn/v1.mp4',
      getAttribute: () => null,
      src: 'https://cdn/v1.mp4',
      querySelectorAll: () => [{ getAttribute: () => 'https://cdn/v2.mp4' }],
    };
    const doc = makeDoc(
      [video],
      [{ getAttribute: () => 'https://cdn/v3.m3u8' }],
    );
    const page = { isClosed: () => false, evaluate: evaluateWithDocument(doc) };
    const result = await extractVideoElements(page as any);
    expect(result).toEqual([
      'https://cdn/v1.mp4',
      'https://cdn/v2.mp4',
      'https://cdn/v3.m3u8',
    ]);
  });

  it('usa getAttribute quando currentSrc é vazio', async () => {
    const video = {
      currentSrc: '',
      getAttribute: () => 'https://cdn/a.mp4',
      src: 'https://cdn/b.mp4',
      querySelectorAll: () => [],
    };
    const doc = makeDoc([video]);
    const page = { isClosed: () => false, evaluate: evaluateWithDocument(doc) };
    const result = await extractVideoElements(page as any);
    expect(result).toEqual(['https://cdn/a.mp4']);
  });

  it('não adiciona elementos sem src no DOM', async () => {
    const doc = makeDoc([], [{ getAttribute: () => null }]);
    const page = { isClosed: () => false, evaluate: evaluateWithDocument(doc) };
    expect(await extractVideoElements(page as any)).toEqual([]);
  });

  it('coleta iframes com src e deduplica (DOM real)', async () => {
    const doc = makeDoc(
      [],
      [],
      [
        { getAttribute: () => 'https://a.test/f1' },
        { getAttribute: () => 'https://a.test/f1' },
        { getAttribute: () => null },
        { getAttribute: () => 'https://b.test/f2' },
      ],
    );
    const page = { isClosed: () => false, evaluate: evaluateWithDocument(doc) };
    expect(await extractAllIframes(page as any)).toEqual([
      'https://a.test/f1',
      'https://b.test/f2',
    ]);
  });
});

describe('extractEpisodeMedia (fluxo de clique)', () => {
  function closedSequence(seq: boolean[]) {
    let i = 0;
    return jest.fn(() => seq[Math.min(i++, seq.length - 1)]);
  }

  it('clica no play, captura stream e incorpora vídeo re-extraído', async () => {
    const el = {
      scrollIntoViewIfNeeded: jest.fn(async () => undefined),
      click: jest.fn(async () => undefined),
    };
    let evaluateCall = 0;
    const requestHandlers: Array<(req: any) => void> = [];
    const page = {
      isClosed: closedSequence([
        false,
        false,
        false,
        false,
        false,
        true,
        false,
      ]),
      evaluate: jest.fn(async () => {
        evaluateCall++;
        if (evaluateCall === 3) return ['https://cdn.new/v2.mp4'];
        return [];
      }),
      on: jest.fn((event: string, cb: any) => {
        if (event === 'request') requestHandlers.push(cb);
      }),
      off: jest.fn(),
      waitForTimeout: jest.fn(async () => {
        for (const h of requestHandlers) {
          h({ url: () => 'https://cdn.test/stream.mp4?t=1' });
        }
      }),
      $: jest.fn(async () => el),
      mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => []) })),
    } as any;

    const result = await extractEpisodeMedia(page);
    expect(result.videos).toEqual([
      'https://cdn.test/stream.mp4?t=1',
      'https://cdn.new/v2.mp4',
    ]);
    expect(el.click).toHaveBeenCalled();
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('usa o iframe como fallback quando o botão não está no topo', async () => {
    const frameEl = { click: jest.fn(async () => undefined) };
    const frame = { $: jest.fn(async () => frameEl) };
    const requestHandlers: Array<(req: any) => void> = [];
    const page = {
      isClosed: closedSequence([
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
      ]),
      evaluate: jest.fn(async () => []),
      on: jest.fn((event: string, cb: any) => {
        if (event === 'request') requestHandlers.push(cb);
      }),
      off: jest.fn(),
      waitForTimeout: jest.fn(async () => {
        for (const h of requestHandlers) {
          h({ url: () => 'https://cdn.test/segment.ts' });
        }
      }),
      $: jest.fn(async () => null),
      mainFrame: jest.fn(() => ({ childFrames: jest.fn(() => [frame]) })),
    } as any;

    const result = await extractEpisodeMedia(page);
    expect(frameEl.click).toHaveBeenCalled();
    expect(result.videos).toEqual([]);
  });
});
