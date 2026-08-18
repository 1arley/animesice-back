# Database

PostgreSQL 15 via Docker (`nestjs-postgres`, porta 5432). Prisma ORM.

## Modelos

```
User          id, email, password, name, role(USER|ADMIN|SUPERADMIN)
RefreshToken  id, token(sha256), userId, expiresAt
Anime         id, slug(unique), title, synopsis, coverImage, bannerImage,
              rating, ageRating, status, audio(LEGENDADO|DUBLADO),
              genres[], episodes[]
Episode       id, number, title, thumbnailUrl, videoUrl, embedUrl,
              duration, dateModified, animeId, unique([animeId, number])
Genre         id, slug(unique), name(unique)
Comment       id, content, userId, animeId?, episodeId?, parentId?
StreamingToken id, token(unique), ip, expiresAt, episodeId
```

## Seed

`npm run seed`:
- Busca top animes no MyAnimeList, fallback offline se a API cair.
- Cria 12 animes com gêneros.
- Cria N episódios placeholder por anime (`videoUrl: null`, `embedUrl: null`).
- Cria admin (`admin@example.com` / `Admin123!`) e user (`user@example.com` / `User123!`).

Seed **não** popula `videoUrl`/`embedUrl` — eps ficam sem vídeo até população manual ou re-extração via `/stream/source`.

## Estado pós-seed

- 144 episódios, todos com `videoUrl: null`.
- Após UPDATE SQL + runtime `/stream/source`: `embedUrl` populado p/ 108 eps mapeados a animefire; `videoUrl` preenchido lazy quando assistido.

## Mapeamento slugs DB → animefire

| DB slug | animefire slug |
|---------|---------------|
| hunter-x-hunter-2011 | hunter-x-hunter-2011 |
| naruto | naruto |
| one-piece | one-piece |
| gintama | gintama |
| spy-x-family | spy-x-family |
| steins-gate | steins-gate |
| mob-psycho-100-iii | mob-psycho-100-iii |
| demon-slayer-kimetsu-no-yaiba | kimetsu-no-yaiba |
| jujutsu-kaisen | jujutsu-kaisen-tv |
| attack-on-titan | shingeki-no-kyojin-dublado |
| fullmetal-alchemist-brotherhood | fullmetal-alchemist-dublado |
| my-hero-academia | boku-no-hero-academia-dublado |

## Comandos

| Script | Ação |
|--------|------|
| `npm run prisma:generate` | Gera client |
| `npm run prisma:migrate` | Roda migrações |
| `npm run prisma:studio` | Interface visual DB |
| `npm run seed` | Popula catálogo |
| `npm run prisma:reset` | Reset completo (deleta tudo) |
