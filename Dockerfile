# Stage 1: Base
FROM node:22-alpine AS base

RUN apk add --no-cache dumb-init

WORKDIR /app

# Stage 2: Dependencies (production only)
FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Stage 3: Build
FROM base AS build

COPY package.json package-lock.json ./
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

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
