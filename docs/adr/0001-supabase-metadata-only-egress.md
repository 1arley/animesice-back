# Supabase serve só metadados; egress é cortado por projeção + cache TTL local

**Status:** aceito (2026-09-12)

A organização Supabase (plano free, limite de egress 5,5 GB/mês) passou dos limites
e entrou em grace period com corte em erro `402`. Diagnóstico do hot path: os bytes
de vídeo **não** passam pelo Supabase — o streaming resolve `.mp4` de CDNs externas
(lightspeedst, googlevideo, r2.dev) via proxy `/embed/media`, e o upload ao bucket
`videos` está morto (service key vazia + `supabase.co` fora da allowlist do proxy).
O egress real é o **tráfego de leitura do Postgres pelo pooler**, amplificado por
(a) endpoints de catálogo que mandavam todas as colunas — inclusive os TEXT
`synopsis`/`editorial*` e arrays que nenhum card renderiza — e (b) o SSR da Vercel
repetir essas mesmas queries a cada page-view, sem cache. Decidimos: o Supabase é
fonte de **metadados**, nunca de byte de usuário; a leitura de catálogo é o único
egress de banco relevante e deve ser **projetada** (devolver só o que a view lê) e
**cacheada** (TTL curto em-processo + `Cache-Control` p/ borda).

## Considered Options

- **Auto-hospedar o Postgres na VPS** (loopback, egress→0 permanente): rejeitado por
  agora — exige migração, backup e uptime próprios, risco desnecessário quando o
  corte de volume resolve o estouro.
- **Redis/KV para cache distribuído**: rejeitado — não há Redis no plano free nem
  budget; é o caminho de invalidação por evento quando houver.
- **Assinar o plano Pro**: rejeitado — sem orçamento.
- **Cache local TTL 120s no catálogo público**: **aceito**. Monorreplica em VPS, sem
  dado por usuário nas rotas cacheadas, e frescor ≤2 min acordado com o produto.

## Consequences

- Supera a linha de `docs/cache-strategy.md` que vedava cache local. A inconsistência
  entre réplicas é aceitável aqui: cada réplica serve um valor próprio, no máximo
  120s defasado, todos válidos. O plano de Redis (invalidação por evento) permanece
  válido para quando a consistência de frescor pesar mais que o egress.
- Efeito colateral conhecido: edição no admin demora até ~120s para aparecer;
  `GET /anime/random` fica de fora do cache (perderia o efeito surpresa).
- A chave do cache inclui a URL completa (com `includeHentai`), então uma resposta
  com catálogo adulto nunca é servida a uma audiência sem opt-in.
- `AdultCatalogSync` virou incremental por cursor `updatedAt` (append-only): títulos
  deletados na origem e edições que só tocam um episódio não são re-puxados — o
  Watchtower segue sendo o dono da correção de episódio.
