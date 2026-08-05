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
