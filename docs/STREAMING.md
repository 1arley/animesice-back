# Streaming

## Rotas

| Rota | Auth | Função |
|------|------|--------|
| `GET /stream/source?anime=&episode=` | Pública | Resolve `videoUrl`, re-extrai da fonte se faltar, devolve `src` do proxy |
| `GET /stream/token?anime=&episode=` | JWT | Gera token IP-bound (legado, exige login) |
| `GET /stream/video?token=&expires=&ip=` | — | Proxy de vídeo via token (legado) |
| `GET /embed/media?url=&referer=` | — | Proxy de mídia: injeta Referer/Origin/UA, stream Range 206 |
| `GET /embed/proxy?url=` | — | Proxy de HTML (remove XFO/CSP p/ iframe) |

## `/stream/source` (recomendado)

1. Busca `Episode.videoUrl` no DB.
2. Se vazio mas `embedUrl` aponta pra fonte com `extractHttp` → re-extrai mp4, persiste.
3. Devolve `{ src }` = `/api/embed/media?url=<mp4>&referer=<fonte>`.
4. Browser `<video src={src}>` → proxy busca CDN com anti-hotlinking → pipe Range.

Sem login, sem token client-side.

## Anti-hotlinking

CDNs pirate (lightspeedst.net) validam `Referer` contra o site fonte (animefire.io), não contra o host da CDN. `EmbedService.proxyMedia` injeta:

```
Referer: https://animefire.io/
Origin:  https://animefire.io
UA:      Chrome 124 desktop
```

## IP-vínculo

Tokens `.mp4` da CDN vinculam ao IP que extraiu. O IP de saída do backend extrai e consome —(proxy resolve. Em prod atrás de proxy, `x-forwarded-proto/host` montam a URL absoluta do `src`.

## Re-extração 403

`StreamingService.proxyVideo` detecta 403 da CDN → `ScrapeService.reextractEpisodeVideo` refaz `extractHttp` e atualiza `Episode.videoUrl`. Só animefire tem `extractHttp`.
