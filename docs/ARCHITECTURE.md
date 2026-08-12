# Arquitetura

NestJS modular. Cada pasta em `src/` é um módulo.

```
src/
├── anime/        Catálogo público (listar, buscar por slug)
├── episode/      Episódios públicos (listar, buscar)
├── streaming/    Stream de vídeo (token JWT ou source público)
├── embed/        Proxy HTML/mídia + scrape multi-fonte (Playwright)
├── admin/        CRUD protegido (ADMIN/SUPERADMIN) + import AniList
├── auth/         JWT access + refresh, bcrypt, RolesGuard
├── user/         Perfil do usuário logado
├── comment/      Comentários em animes/episódios
├── genre/        Gêneros
├── upload/       Supabase Storage (upload de vídeo)
├── prisma/       PrismaClient wrapper
└── common/       Filtros, interceptors, enums
```

## Fluxo de streaming

```
Browser ──> /api/stream/source?anime=X&episode=Y (público)
  │
  ├─ videoUrl no DB? ──> usa direto
  └─ embedUrl + extractHttp? ──> re-extrai mp4 da fonte, persiste
  │
  └─> devolve src = /api/embed/media?url=<mp4>&referer=<fonte>
       │
       └─ Browser <video> ──> /api/embed/media
            │
            └─ backend fetcha CDN com Referer/Origin anti-hotlinking
               e faz pipe do stream (Range 206) p/ o browser
```

Pontos-chave: vídeos não são baixados, é proxy sob demanda. IP-vínculo da CDN resolved pelo IP de saída do backend.

## Provider Orchestration Layer (scraping/embed)

O `ScrapeService` (src/embed/scrape/) é o orquestrador de providers: ele escolhe
dinamicamente a fonte mais saudável em vez de depender de um scraper específico.

```
/api/embed/scrape ─┐
/stream/source    ──┤
watchtower        ──┤
                    ▼
           ScrapeService (orquestrador)
             │ resolveSource: health-aware
             ▼
      HealthMonitor (watchtower)
        • rankedSources() → ordem por score (sucesso × 1/(1+latência))
        • recordSuccess/recordFailure → desabilita após 5 falhas consecutivas
        • canário reviveOne() p/ recuperação
             │
             ▼
   [meusanimes] [animefire] [animesonlinecc] (+ genérico)
             │ extractHttp (HTTP puro) ou extract (Playwright)
             ▼
   Cache SWR em memória (por sourceId + URL do episódio)
     • TTL fresco → serve direto (sem consumir slot de chromium)
     • janela stale → serve imediatamente + revalida em background (single-flight)
     • fetch falha + stale disponível → degrada servindo o stale
```

Regras:

- **Escolha dinâmica**: `resolveSource()` consulta `HealthMonitor.rankedSources()`
  (que exclui sources `disabled`) e escolhe a fonte mais saudável que `supports(url)`.
  Fonte explicitamente forçada (`sourceId`) é sempre honrada.
- **Health centralizado**: o registro de success/failure/latência é feito pelo
  `ScrapeService` no hot path (cache hit não registra). O `Extractor` do watchtower
  apenas consome resultados — não registra mais (evita dupla contagem).
- **Cache**: single-instance (Map em memória), RAW (wrap aplicado na saída),
  single-flight por chave, teto de 200 entradas. Tune via `SCRAPE_CACHE_TTL_MS`
  e `SCRAPE_CACHE_STALE_MS` (ver environment-variables.md).
- **Re-extração (403 da CDN)**: `reextractEpisodeVideo` escolhe a fonte HTTP mais
  saudável, invalida o cache do episódio e o semeia com o resultado fresco.
- **Módulos**: EmbedModule ↔ WatchtowerModule são circulares de propósito
  (embed consome health; watchtower consome scrape) — resolvidos com `forwardRef`.
