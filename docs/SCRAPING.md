# Scraping

## Fontes

| Adapter | Host | HTTP puro | Playwright |
|---------|------|-----------|------------|
| `meusanimes.source.ts` | meusanimes.blog | ✅ `extractHttp` | fallback Chromium (tokens Blogger) |
| `animesonline.source.ts` | animesonlinecc.to, animesonline.cloud | ✅ `extractHttp` | fallback genérico |
| `animesdigital.source.ts` | animesdigital.org | ✅ `extractHttp` | fallback genérico |

## Scraper Rust (binário único)

`scraper-rust/` atende as três fontes ativas. Um binário só, com fallback por
`<FONTE>_RUST_BIN`; vazio = fonte segue no Node, sem mudança de comportamento.

| Fonte | Host reconhecido | Env | Modo |
|-------|------------------|-----|------|
| meusanimes | `meusanimes.blog`, `*.meusdoramas.club` | `MEUSANIMES_RUST_BIN` | `MEUSANIMES_RUST_MODE` |
| animesonline | `animesonlinecc.to`, `animesonline.cloud` e subdomínios | `ANIMESONLINE_RUST_BIN` | `ANIMESONLINE_RUST_MODE` |
| animesdigital | `animesdigital.org`, subdomínios | `ANIMESDIGITAL_RUST_BIN` | `ANIMESDIGITAL_RUST_MODE` |

`MODE=primary` (default) usa o Rust quando ele devolve resultado; vazio, erro ou
timeout caem para o `extractHttp` em Node com log. `MODE=shadow` só loga o
resultado do Rust e segue no Node. Host fora da allowlist do binário sai com
`URL fora dos domínios permitidos`.

Diferenças do Rust contra o Node: sem probe de liveness por candidata
(`probeMediaUrlDead`) e sem `resolve_server` — o Rust devolve no máximo 4
candidatas e quem valida é o `streaming.service`, que probe antes de servir.
`animefire` foi removido (fonte morta): o binário rejeita o host.

Check local do binário: `cd scraper-rust && cargo test`.

`animesonlinecc.to` retornou 403 na VPS em 28/09/2026. Em 27/10/2026, a amostra
local encontrou `.cloud` com episódio em HTTP 200 e o caminho equivalente em `.cc`
com 404; disponibilidade varia por origem. O adapter tenta os dois hosts, mantendo
o `.cc` primeiro para links já persistidos. HTTP 200 não confirma que o vídeo toca.
`animefire.io` segue inativo; `animesonline.lat` responde 200 mas não tem servidores
para os animes do catálogo.

## animesonline

Os hosts `.cloud` e `.cc` são tentados para a mesma variante de slug, nessa ordem.
As medições variaram entre a VPS e o ambiente local, então HTTP 404 de um host não
encerra a busca. Padrão de episódio: `/episodio/<slug>-episodio-<n>` (barra final
opcional). Slugs do WordPress podem divergir dos do meusanimes; o resolver procura
os links na página do anime e confirma o número exato do episódio.

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
