# AGENTS.md

## Tech stack

NestJS 11 · TypeScript 5.9 · Prisma 7 · PostgreSQL 15 · Node 22 · Docker multi-stage build.

## Quick commands

```bash
# Setup
npm install && npx prisma generate

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

## Key env vars

`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (all required, ≥32 chars). `TURNSTILE_SECRET` for CAPTCHA. `EMBED_ALLOWED_HOSTS` for media proxy allowlist (fail-closed if empty). `TRUST_PROXY` must stay `false` unless behind Cloudflare with proper firewall.

## Architecture

Feature modules in `src/<feature>/` each contain controller + service + module. Global providers: `PrismaModule`, `ThrottlerBehindProxyGuard` (rate limiting), `AuditInterceptor`. WebSocket via `@nestjs/platform-socket.io`. Swagger at `/api/docs` in non-prod. Streaming uses signed URLs (token + IP + expiry).

## Don'ts

- Don't run `prisma migrate` against production URL accidentally — always verify `DATABASE_URL` before migrating.
- Don't add `any` casts in `src/` — ESLint will fail.
- Don't skip `npx prisma generate` after schema changes — the build will fail.
- Don't use `tsc` directly to compile — use `npm run build` (NestJS compiler).
