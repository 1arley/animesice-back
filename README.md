# 🧊 AnimesIce Backend

<div align="center">

![NestJS](https://img.shields.io/badge/NestJS-v11.0.1-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-v5.7.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-v6.16.3-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)

![CI](https://github.com/1arley/animesice-back/actions/workflows/ci.yml/badge.svg)
![Security](https://github.com/1arley/animesice-back/actions/workflows/security.yml/badge.svg)
![Release](https://github.com/1arley/animesice-back/actions/workflows/release.yml/badge.svg)
![Deploy](https://github.com/1arley/animesice-back/actions/workflows/deploy.yml/badge.svg)

**Backend da AnimesIce - API de catálogo de animes com streaming, auth JWT, Swagger, Prisma e Docker**

[Documentação](#-documentação) • [Quick Start](#-quick-start) • [Features](#-features) • [CI/CD](#-cicd) • [Contribuir](#-contribuindo)

</div>

---

## 📖 Sobre o Projeto

Backend da **AnimesIce** — API de catálogo de animes com streaming de vídeos (token + expires + IP), autenticação JWT, Prisma ORM e Docker. Autor: **Arthur Iarley**.

### 🎯 Objetivo

Fornecer API robusta para catálogo de animes, episódios, gêneros, streaming de vídeo com URLs assinadas (token + expires + IP), crawl/scrape de fontes externas e autenticação de usuários.

---

## 📚 Documentação Adicional

Consulte a pasta `docs/` para guias detalhados:

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Visão geral dos módulos e fluxo de streaming
- [STREAMING.md](docs/STREAMING.md) - Como o vídeo chega ao player (proxy, anti-hotlinking, IP-vínculo)
- [SCRAPING.md](docs/SCRAPING.md) - Extração multi-fonte (animefire HTTP, Playwright, re-extração)
- [ADMIN-CRUD.md](docs/ADMIN-CRUD.md) - Endpoints admin + status da UI frontend
- [DATABASE.md](docs/DATABASE.md) - Schema, seed, mapeamento slugs, comandos Prisma
- [DEPLOY.md](docs/DEPLOY.md) - Env vars, build backend/frontend, Docker, caveats
- [docker.md](docs/docker.md) - Configuração Docker
- [authentication.md](docs/authentication.md) - Autenticação JWT
- [api-documentation.md](docs/api-documentation.md) - Documentação Swagger
- [husky-setup.md](docs/husky-setup.md) - Husky + lint-staged
- [husky-semantic-release.md](docs/husky-semantic-release.md) - Conventional Commits
- [code-conventions.md](docs/code-conventions.md) - Convenções de código
- [nvm-setup.md](docs/nvm-setup.md) - Node Version Manager

---

## 🔁 CI/CD

O repositório tem quatro workflows em `.github/workflows/`:

| Workflow         | Gatilho                                         | O que faz                                                                                                                                       |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **ci.yml**       | PR ou push para `main`/`dev`                    | Lint, Prettier, typecheck, testes unitários (coverage), testes E2E (Postgres efêmero via service container), build Nest, build da imagem Docker |
| **security.yml** | PR, push, schedule (semanal)                    | `npm audit` (high+), Gitleaks (secret scan), CodeQL (JS/TS), Dependency Review em PRs                                                           |
| **release.yml**  | Após `CI` concluir com sucesso (`workflow_run`) | `semantic-release` com Conventional Commits → tag `v*`, GitHub Release e `CHANGELOG.md` (ver `.releaserc`)                                      |
| **deploy.yml**   | `release: published` ou `workflow_dispatch`     | Constrói e publica a imagem Docker no `ghcr.io/1arley/animesice-back`, e faz deploy via SSH em um host Docker (ambiente `production`)           |

### Fluxo de implantação

```
push main ─▶ CI ─▶ Release (stable vX.Y.Z) ─▶ Deploy (production)
push dev  ─▶ CI ─▶ Release (prerelease, ex. 1.2.3-dev.1) ─▶ (sem deploy)
PR/push   ─▶ security (paralelo)
```

- **CI obrigatório**: Release só roda se `workflow_run.conclusion == 'success'`.
- **Produção só de `main`**: prereleases de `dev` **não** disparam Deploy (`github.event.release.prerelease == false`). PRs nunca fazem deploy.
- **Ambiente `production`**: Protection Rules no GitHub (required reviewers, branch `main`, wait timer). Job de deploy pausa até aprovação.
- **Rollback**: Actions → Deploy → _Run workflow_ com tag anterior (ex.: `v1.0.0`).

### Image registry

Imagens são publicadas em `ghcr.io/1arley/animesice-back:<tag>` e `:latest` (ex.: `ghcr.io/1arley/animesice-back:v1.2.3`). Build com cache Buildx/`type=gha`.

### Secrets necessários (GitHub Secrets / Environment)

> Configurar em **Settings → Secrets and variables → Actions**. Os marcados **(environment)** pertencem ao ambiente `production`.

| Secret              | Onde       | Descrição                                                                           |
| ------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`      | automático | Usado para Release, GHCR push e CodeQL (não precisa criar).                         |
| `DEPLOY_HOST`       | production | Host/IP do servidor Docker.                                                         |
| `DEPLOY_PORT`       | production | Porta SSH (ex.: `22`).                                                              |
| `DEPLOY_USER`       | production | Usuário SSH no servidor.                                                            |
| `DEPLOY_SSH_KEY`    | production | Chave privada SSH (PEM).                                                            |
| `DEPLOY_APP_DIR`    | production | Caminho absoluto no servidor com o `docker-compose.prod.yml` e `.env` da aplicação. |
| `DEPLOY_GHCR_USER`  | production | Usuário/PAT do GitHub com `read:packages` para o servidor fazer `docker pull`.      |
| `DEPLOY_GHCR_TOKEN` | production | PAT (`ghp_…`) com `read:packages` para o servidor.                                  |

> 💡 Em vez do `GITHUB_TOKEN` efêmero para o `docker login` no servidor, usamos um PAT (`DEPLOY_GHCR_TOKEN`) gravado no servidor, pois o `GITHUB_TOKEN` do runner não é válido no host remoto.

### Configuração manual no GitHub (uma vez)

1. **Branch protection** (Settings → Branches) para `main` e `dev`:
   - Required status checks: `CI / Lint · Format · Typecheck`, `CI / Unit tests`, `CI / E2E tests`, `CI / Build`, `Security`.
   - Require PR review, require Code Owners review (usa `.github/CODEOWNERS`).
   - Require branches up to date before merge.
2. **GitHub Environment** (Settings → Environments → New environment → `production`):
   - Required reviewers (quem aprova o deploy).
   - Deployment branch → `main`.
   - Wait timer (ex.: 60s) se desejado.
   - Adicione os Secrets marcados **(environment)** acima neste ambiente.
3. **Repository Secrets** (Settings → Secrets → Actions): nenhum além do automatic `GITHUB_TOKEN` é necessário se todos os secrets de deploy estiverem no Environment `production`.
4. **Dependabot**: `.github/dependabot.yml` já configura atualizações semanais de npm e GitHub Actions.
5. (Opcional) **Code scanning**: os SARIF do CodeQL/Gitleaks aparecem automaticamente em Security → Code scanning alerts.

### Rodar os mesmos checks localmente

```bash
npm install                # ou: npm ci
npx prisma generate        # gera o client do Prisma

# Qualidade
npm run lint
npx prettier --check "src/**/*.ts" "test/**/*.ts"
npx tsc --noEmit -p tsconfig.json

# Testes (Postgres de teste sobe/via docker-compose.test.yml)
npm run test:unit
npm run test:e2e           # precisa do Docker (container postgres na porta 5433)

# Build
npm run build
docker build -t animesice-back:local .
```

---
