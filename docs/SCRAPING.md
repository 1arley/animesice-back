# Scraping

## Fontes

| Adapter | Host | HTTP puro | Playwright |
|---------|------|-----------|------------|
| `animefire.source.ts` | animefire.io | ✅ `extractHttp` | fallback inerte |
| `animesonlinecc.source.ts` | animesonlinecc.to | ❌ | ✅ |
| `meusanimes.source.ts` | meusanimes.blog | ❌ | ✅ |

## extractHttp (animefire)

Sem browser. 2 fetchs:

1. `GET /animes/<slug>/<ep>` → HTML tem `data-video-src=".../video/<slug>?..."`.
2. `GET /video/<slug>?...` com `Referer: animefire.io` → JSON `{ data:[{ src, label }] }`.

Devolve RAW `https://lightspeedst.net/.../hd/N.mp4?token=...&ip=<ip_backend>`. Sem Cloudflare.

## wrapMediaUrl

`ScrapeService.wrapMediaUrl` envolve mp4 externo em `/embed/media?url=...&referer=<origem>`. Anti-hotlinking resolvido no proxy, não no client.

## Playwright (animesonlinecc, meusanimes)

`chromium.launch({ headless:true })` → `goto` → detecta Cloudflare → aguarda player → `source.extract(page)` extrai `<video>`/`<source>`/iframes. Se vazio, estrategia genérica clica play e intercepta `videoplayback`. Blogger: abre token `blogger.com/video.g?token=` em frame próprio.

## Re-extração

`reextractEpisodeVideo(animeSlug, episodeNumber)`:
- Busca `Episode.embedUrl`.
- Encontra adapter com `extractHttp` que suporta a URL.
- Extrai, atualiza `videoUrl` no DB.
- Retornado por `StreamingService.proxyVideo` em 403.
