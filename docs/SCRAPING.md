# Scraping

## Fontes

| Adapter | Host | HTTP puro | Playwright |
|---------|------|-----------|------------|
| `meusanimes.source.ts` | meusanimes.blog | ✅ `extractHttp` | fallback Chromium (tokens Blogger) |
| `animesonline.source.ts` | animesonline.cloud | ✅ `extractHttp` | fallback genérico |
| `animesdigital.source.ts` | animesdigital.org | ✅ `extractHttp` | fallback genérico |

Hosts bloqueados para IP de datacenter (medido na VPS em 28/09/2026): `animefire.io`
e `animesonlinecc.to` → 403 Cloudflare WAF; `animesonline.lat` responde 200 mas não
tem servidores para os animes do catálogo.

## animesonline

`animesonline.cloud` validado na VPS em 28/09/2026: páginas em HTTP 200 sem
challenge (0,2–2,4s), com o player renderizado server-side. Padrão de episódio:
`/episodio/<slug>-episodio-<n>` (sem barra final). Slugs do WordPress próprio podem
divergir dos do meusanimes — a URL é candidata; probe 404 descarta antes do fetch.

Sem browser no caminho feliz: 1 fetch + até 4 probes de liveness.

1. `GET /episodio/<slug>-episodio-<n>` → candidatas na ordem do HTML: `<source>`/
   `<video>.mp4` primeiro, URLs inline `.mp4/.m3u8` depois.
2. Probe `Range: bytes=0-0` em até 4 candidatas (`probeMediaUrlDead(url, true)`,
   forceNetwork para não confundir erro de DNS com "vivo"): descarta `cld.pt`
   (DNS morto) e `mangas.cloud` (403 Cloudflare); mantém `animeflix.blog`
   (206 video/mp4).
3. Sem `.mp4` vivo → tokens `blogger.com/video.g?token=` vão em `playerTokens` e o
   `ScrapeService` resolve via Chromium (mesmo fluxo do meusanimes).

O host do `.mp4` (`animeflix.blog`, e `ccdn.xyz` quando a playlist existir) precisa
estar em `EMBED_ALLOWED_HOSTS` — o proxy de mídia é fail-closed.

Cobertura medida (VPS, 28/09/2026): 22/40 dos animes mais publicados existem lá com
o mesmo slug; 6/8 páginas de episódio testadas existiram — 2 extraíram `.mp4` vivo
direto, 2 só tinham token Blogger (resolvível), 2 sem candidata utilizável.

## meusanimes

1. `GET /e/<slug>-episodio-<n>/` → iframe `servNN.meusdoramas.club/#/video/<tmdb>/<s>/<e>`.
2. `GET https://servNN.meusdoramas.club/posts/get-video.php?...` com
   `Referer: meusanimes.blog` → JSON com token Blogger.
3. Token resolvido via Chromium → `.mp4` googlevideo (expira em ~4 dias; o fluxo
   403 do proxy re-extrai automaticamente).

Amostra de 10 páginas persistidas na VPS (28/09/2026): 10/10 `get-video.php` OK.

## animesdigital

`animesdigital.org` fica atrás de `ANIMESDIGITAL_ENABLED=true` e usa somente URLs
reais persistidas em `EpisodeSource`; nunca converte slug AnimeSice.

Sem browser, 1 fetch:

1. `GET <pageUrl>` → coleta `<iframe src>`.
2. O parâmetro `?d=` de cada iframe precisa apontar para `.m3u8`/`.mp4` → devolve
   como RAW.

## wrapMediaUrl

`ScrapeService.wrapMediaUrl` envolve mp4 externo em `/embed/media?url=...&referer=<origem>`. Anti-hotlinking resolvido no proxy, não no client.

## Playwright (meusanimes)

`chromium.launch({ headless:true })` → `goto` → detecta Cloudflare → aguarda player → `source.extract(page)` extrai `<video>`/`<source>`/iframes. Se vazio, estrategia genérica clica play e intercepta `videoplayback`. Blogger: abre token `blogger.com/video.g?token=` em frame próprio.

## Re-extração

`reextractEpisodeVideo(animeSlug, episodeNumber)`:
- Busca `Episode.embedUrl`.
- Encontra adapter com `extractHttp` que suporta a URL.
- Extrai, atualiza `videoUrl` no DB.
- Retornado por `StreamingService.proxyVideo` em 403.
