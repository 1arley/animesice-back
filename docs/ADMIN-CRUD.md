# Admin CRUD

Todas as rotas `/admin/*` exigem JWT + role `ADMIN` ou `SUPERADMIN`.

## Endpoints

| Método | Rota | Função |
|--------|------|--------|
| `GET` | `/admin/animes?page=&limit=` | Lista animes com contagem de eps |
| `POST` | `/admin/anime` | Cria anime manual ( Campos: title, slug, synopsis, coverImage, bannerImage, rating, status, audio, ageRating, genreSlugs[] ) |
| `POST` | `/admin/anime/import` | Importa via AniList (anilistId ou search + audio) |
| `PATCH` | `/admin/anime/:slug` | Atualiza anime |
| `DELETE` | `/admin/anime/:slug` | Remove anime |
| `POST` | `/admin/episode/:slug` | Cria episódio (number, title, videoUrl, embedUrl, thumbnailUrl, duration) |
| `PATCH` | `/admin/episode/:slug/:number` | Atualiza episódio |
| `DELETE` | `/admin/episode/:slug/:number` | Remove episódio |
| `POST` | `/admin/episode/:slug/:number/upload` | Upload .mp4/.m3u8/.ts → Supabase Storage |
| `POST` | `/admin/genre` | Cria gênero |

## Frontend

| Página | Status |
|--------|--------|
| `/admin` | ✅ Lista catálogo + deletar anime |
| `/admin/create` | ✅ Criar anime manual |
| `/admin/import` | ✅ Import do AniList |
| `/admin/episode/[slug]/[number]` | ✅ Editar ep (videoUrl, embedUrl, scrape, upload, deletar) |
| `/admin/create-episode/[slug]` | ✅ Criar episódio manual |
| Criar anime manual | ✅ |
| Criar episódio manual | ✅ |
| Deletar anime | ✅ |
| Deletar episódio | ✅ |

## Guia do Administrador

### Acessar o painel
1. Faça login com conta ADMIN/SUPERADMIN em `/login`
2. Acesse `/admin` — veja o catálogo completo
3. Se não ver a tabela, seu usuário não tem permissão ADMIN

### Criar anime
**Opção A: Import do AniList (recomendado)**
1. `/admin/import`
2. Digite o nome do anime ou AniList ID
3. Selecione áudio (Legendado/Dublado)
4. Clique "Importar" → metadados vêm do AniList (capa, sinopse, gêneros)

**Opção B: Criação manual**
1. `/admin/create`
2. Preencha título (slug auto-gerado), sinopse, capa, banner, status, áudio, classificação
3. Selecione gêneros (criados previamente na DB)
4. Clique "Criar anime"

### Criar episódio
1. Na lista `/admin`, encontre o anime
2. Clique **+ ep** ao lado do anime
3. Preencha número, título, URL do vídeo (.mp4/.m3u8), embed URL, thumbnail, duração
4. Clique "Criar episódio"

### Editar episódio (URL do vídeo)
1. Na lista `/admin`, clique no título do anime
2. Ajuste o número na URL: `/admin/episode/[slug]/[numero]`
3. **4 formas de preencher o vídeo:**
   - **Direto:** Cole a URL .mp4/.m3u8 no campo "URL do vídeo"
   - **Upload:** Envie arquivo .mp4/.m3u8/.ts → Supabase Storage (URL preenchida automaticamente)
   - **Scrape:** Insira a URL do episódio em site externo (animefire, animesonlinecc, meusanimes), clique "Extrair vídeo" ou "Gerar embed URL"
   - **Lazy (automático):** Se só embedUrl estiver preenchida (ex: animefire.io/animes/slug/ep), o backend extrai o .mp4 no primeiro acesso do player via `/stream/source`

### Deletar anime
1. `/admin`
2. Clique **deletar** → confirma → exclui definitivamente (episódios em cascata)

### Deletar episódio
1. Vá para `/admin/episode/[slug]/[numero]`
2. Role até "Zona de exclusão"
3. Clique "Deletar este episódio" → confirmar

### Como o vídeo funciona (streaming)
- O player chama `GET /stream/source?anime=slug&episode=N` (público, sem JWT)
- Se `videoUrl` existe: serve direto via proxy de mídia (`/embed/media?url=...`)
- Se `videoUrl` vazio mas `embedUrl` existe: re-extrai da fonte (animefire HTTP puro), persiste videoUrl, serve
- O proxy injeta Referer/Origin anti-hotlinking + usa IP do backend (IP-vínculo da CDN resolvido server-side)
- Em 403 (token da CDN expirado): re-extração automática transparente

### Seeding
```bash
# Seed básico: top animes do Jikan/MAL + episódios placeholder + embedUrl animefire
npm run seed

# Seed completo do catálogo animefire (sitemap + AniList enriquecimento)
npm run seed:animefire

# Testar com 5 animes primeiro
npm run seed:animefire:dry

# Pular AniList (só catálogo sem metadados ricos)
npm run seed:animefire -- --skip-anilist

# Paginar catálogo grande
npm run seed:animefire -- --offset 100 --limit 50
```
