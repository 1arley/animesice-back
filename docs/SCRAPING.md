# Scraping

## Fontes

| Adapter                    | Host              | HTTP puro        | Playwright        |
| -------------------------- | ----------------- | ---------------- | ----------------- |
| `animefire.source.ts`      | animefire.io      | ✅ `extractHttp` | fallback inerte   |
| `animesonlinecc.source.ts` | animesonlinecc.to | ❌               | ✅                |
| `meusanimes.source.ts`     | meusanimes.blog   | ✅               | fallback Chromium |
| `animesdigital.source.ts`  | animesdigital.org | ✅               | fallback Chromium |

## extractHttp (animefire)

## animesdigital

`animesdigital.org` foi validado na VPS em 17/09/2026: 12 páginas de episódios,
12 animes, HTTP 200 e playlists HLS `.m3u8` acessíveis diretamente no CDN.
Adapter fica atrás de `ANIMESDIGITAL_ENABLED=true` e usa somente URLs reais
persistidas em `EpisodeSource`; nunca converte slug AnimeSice.

Sem browser. 2 fetchs:

1. `GET /animes/<slug>/<ep>` → HTML tem `data-video-src=".../video/<slug>?..."`.
2. `GET /video/<slug>?...` com `Referer: animefire.io` → JSON `{ data:[{ src, label }] }`.

Devolve RAW `https://lightspeedst.net/.../hd/N.mp4?token=...&ip=<ip_backend>`. Sem Cloudflare.

### Experimento Rust

O Docker compila `scraper-rust/` como binário `/usr/local/bin/animefire-scraper`,
mas o Node continua padrão. Configure `ANIMEFIRE_RUST_BIN` para ativá-lo.
`ANIMEFIRE_RUST_MODE=shadow` roda Rust e Node sequencialmente para comparar
latência e quantidade de URLs úteis; a resposta continua vindo do Node. Use
`primary` depois de coletar amostra representativa; erros Rust voltam ao Node.
O binário aceita somente `animefire.io` e subdomínios, limita tempo e corpo das
respostas e rejeita redirecionamentos para fora do domínio.

O modo shadow dobra as requisições à fonte durante a medição. Compare janelas
com tráfego semelhante e acompanhe sucesso, p50/p95 do cliente e CPU do
contêiner. Não conclua ganho de produção usando apenas a duração isolada do
extrator: o fluxo é HTTP-bound e o processo Rust inicia a cada chamada.

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
