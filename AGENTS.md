# AGENTS.md

## Tech stack

NestJS 11 · TypeScript 5.9 · Prisma 7 · PostgreSQL 15 · Node 22 · Docker multi-stage build.

## Quick commands

```bash
# Setup
npm install && npx prisma generate

# Full CI locally (identical to GitHub Actions, one command)
npm run ci:local                        # quality + unit + e2e + audit + build + docker image
npm run ci:local -- --skip-docker       # fast loop: skip the slow image build
npm run ci:local -- --fresh             # npm ci + prisma generate first (validates lockfile)

# Quality (matches CI exactly)
npm run lint
npx prettier --check "src/**/*.ts" "test/**/*.ts"
npx tsc --noEmit -p tsconfig.json

# Unit tests (no DB required)
npx dotenv-cli -e .env.test -- npm run test:unit

# E2E tests (needs Postgres on port 5433)
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d
npx dotenv-cli -e .env.test -- npx prisma migrate deploy
npx dotenv-cli -e .env.test -- npx jest --config ./test/jest-e2e.json --runInBand --forceExit

# Dev server
npm run dev
```

## Verification order (matches CI)

1. `npm run lint`
2. `npx prettier --check "src/**/*.ts" "test/**/*.ts"`
3. `npx tsc --noEmit -p tsconfig.json`
4. Unit tests (`.env.test` loaded via dotenv-cli)
5. E2E tests (real Postgres, migrations must be applied)
6. `npm run build`

Always run quality checks before tests. Lint or typecheck failures will fail CI regardless of test results.

`npm run ci:local` (`scripts/ci-local.sh`) runs that whole order plus the npm
audit and Docker image steps, starting/stopping the Postgres test container
itself. Run it before pushing — green here means green Actions.

## Path aliases

`tsconfig.json` defines: `@/*` → `src/*`, `~/` → `src/*`, `@test/*` → `test/*`. These must also be mirrored in `moduleNameMapper` inside `jest.config.mjs` and `test/jest-e2e.json` when adding new patterns.

## ESLint rules (production code is strict)

- `no-explicit-any`: **error** in `src/`, **off** in `test/`
- `no-floating-promises`: error (allow `void`)
- `no-unsafe-*` family: all error in `src/`, all off in `test/`
- `require-await`: error
- Prettier enforces `singleQuote: true`, `trailingComma: "all"`, `endOfLine: "lf"`

## Commits

Conventional Commits enforced by commitlint + husky. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`. Header max 150 chars.

## Prisma

- Schema: `prisma/schema.prisma`
- Generate before build: `npx prisma generate`
- New migrations: `npx prisma migrate dev --name <name>`
- Test DB: `postgresql://postgres:postgres@localhost:5433/animesice-db-test`
- PrismaModule is `@Global` — inject `PrismaService` directly, no need to import PrismaModule per feature module.

## Docker

Multi-stage build (base → deps → build → production). Chromium + Xvfb installed for Playwright scraping. Production image runs as `node` user. Healthcheck hits `GET /api`.

## Release & deploy

- `main` branch → stable release (`vX.Y.Z`) → triggers deploy to production
- `dev` branch → prerelease (`vX.Y.Z-dev.N`) → no deploy
- Images pushed to Docker Hub (`DOCKERHUB_REPO` secret, tag + `latest`) → Watchtower on the VPS applies them (no SSH)
- Deploy is gated on tags/releases only — never from a PR, and automatic builds skip prereleases. Manual `workflow_dispatch` is the rollback path.
- `deploy.yml` has a single automatic trigger: `workflow_run` on the Release workflow (`main`). Do not re-add a `release: [published]` trigger — semantic-release pushes with `GITHUB_TOKEN`, which never spawns workflow runs, so it is dead config that can double-build a tag when a release is published by hand. There is no `dev` image publish; the only image builder for releases is `deploy.yml`.

## Key env vars

`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (all required, ≥32 chars). `TURNSTILE_SECRET` for CAPTCHA. `TRUST_PROXY` must stay `false` unless behind Cloudflare with proper firewall.

`EMBED_ALLOWED_HOSTS` é só a allowlist **estática** do proxy de mídia (fail-closed se vazia). O CDN do topanimes muda por episódio e não tem domínio comum, então ele **não** pode ser mantido à mão: quem resolve é `src/common/trusted-media-hosts.ts`, que confia no host que **o próprio scraper** extraiu, probeou e persistiu em `Episode.videoUrl`. Ponto único de registro: `ScrapeService.wrapResult`. O conjunto é reconstruído do banco no boot e de hora em hora. Isso **não** afrouxa SSRF — `isBlockedHostname` roda antes, em `validateAndNormalizeUrl` — e a confiança é por host exato, sem herdar para subdomínio. Os domínios que estão no `EMBED_ALLOWED_HOSTS` são belt-and-braces; se precisar tocar, meça antes.

`MAX_CONCURRENT_SCRAPES` (=`TICK_CONCURRENCY`, prod=6) é o que define a taxa do backfill. `claimBatch` usa `min(WT_TICK_BATCH, TICK_CONCURRENCY)`, então subir só `WT_TICK_BATCH` **não faz nada**. Elevar exige `mem_limit` junto: os caminhos animesorion/animexhd resolvem token Blogger via Chromium (~60-100 MB por contexto).

## Fontes de vídeo (regras que custaram tempo)

- **Slug nosso ≠ slug da fonte.** Nosso slug carrega áudio/temporada (`bleach-dublado-2`), os sites indexam por nome (`bleach`). Cada fonte resolve em 2 passos: variantes de slug na URL template e, se falhar, a **listagem da página do anime**.
- **As listagens estão no HTML estático** e usam `href='...'` com **aspas simples**. Regex que só caseia aspas duplas devolve zero e faz a fonte parecer sem episódios — foi assim que o topanimes pareceu não ter nada.
- **Teste o caminho real, não Playwright naïf.** Espera fixa por `<video>` dá falso negativo: o Blogger resolve em `resolvePlayerToken` (event-driven por `batchexecute`). O commit `5553ccf` registrou que o player Blogger estava quebrado na VPS — **estava errado**, e a conclusão errada foi "animesorion está inativo".
- `playerflix.ink` responde **0 bytes sem o Referer** correto; a cadeia quebra em silêncio sem isso.
- **CUIDADO na VPS:** o Watchtower clona a config do container, então **mudança em `.env` (`env_file`) não é relida** — precisa recreate. Não há `docker compose` na VPS (nem plugin nem v1). E o `docker-compose.yml` do host declara `prisma migrate deploy && ...`, mas o container em produção roda `|| true`: há migration com `rolled_back_at`, e com `&&` ela derrubaria o boot.

## Architecture

Feature modules in `src/<feature>/` each contain controller + service + module. Global providers: `PrismaModule`, `ThrottlerBehindProxyGuard` (rate limiting), `AuditInterceptor`. WebSocket via `@nestjs/platform-socket.io`. Swagger at `/api/docs` in non-prod. Streaming uses signed URLs (token + IP + expiry).

## Don'ts

- Don't run `prisma migrate` against production URL accidentally — always verify `DATABASE_URL` before migrating.
- Don't add `any` casts in `src/` — ESLint will fail.
- Don't skip `npx prisma generate` after schema changes — the build will fail.
- Don't use `tsc` directly to compile — use `npm run build` (NestJS compiler).
