# Stage 1: Base
# Debian slim (glibc): Playwright chromium não roda em Alpine (musl).
# Xvfb: necessário para headless:false (token Blogger só renderiza com display).
FROM node:24-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Stage 2: Dependencies (production only)
FROM base AS deps

COPY .npmrc package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Stage 3: Build
FROM base AS build

COPY .npmrc package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma/
COPY prisma.config.ts ./
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
ENV DATABASE_URL=""

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src/
RUN npm run build

# Stage 4: Production
FROM base AS production

ENV NODE_ENV=production

COPY --from=base /usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/prisma.config.ts ./
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Chromium p/ o fluxo Playwright (scrape de fontes + resolver tokens Blogger
# do meusanimes/meusdoramas -> .mp4 googlevideo). Browser fora do home do user
# p/ persistir entre stages e ficar legivel ao `USER node`.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

# Prisma CLI roda como USER node e precisa gravar engines/cache.
# Xvfb precisa de /tmp/.X11-unix com permissões corretas.
# O entrypoint executa o CLI local (node_modules/.bin/prisma) — nunca `npx -y`,
# que baixaria o pacote da rede em todo boot e derrubaria o container sem rede.
RUN chown -R node:node /app/node_modules /ms-playwright && \
    mkdir -p /tmp/.X11-unix && \
    chmod 1777 /tmp/.X11-unix && \
    chmod +x /usr/local/bin/entrypoint.sh && \
    test -x /app/node_modules/.bin/prisma

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Entrypoint aplica migrations pendentes antes de subir o app. Estar na imagem
# (e não no `command` do compose) é o que garante que nenhuma environment
# pule `prisma migrate deploy` — compose override é a forma mais comum de
# divergence entre schema do repo e banco.
#   SKIP_MIGRATE=1  pula (bootstrap de banco novo, restore de dump)
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
