FROM node:20-bullseye-slim AS api_deps
WORKDIR /app/api
COPY api/package*.json api/tsconfig.json ./
COPY api/prisma ./prisma
RUN npm ci

FROM node:20-bullseye-slim AS ui_deps
WORKDIR /app/ui
COPY ui/package*.json ui/tsconfig.json ui/vite.config.ts ui/index.html ./
COPY ui/public ./public
COPY ui/src ./src
RUN npm ci

FROM node:20-bullseye-slim AS build
WORKDIR /app

# Build API
COPY --from=api_deps /app/api/node_modules ./api/node_modules
COPY api ./api
RUN cd api && npm run prisma:generate && npm run build

# Build UI
COPY --from=ui_deps /app/ui/node_modules ./ui/node_modules
COPY ui ./ui
RUN cd ui && npm run build

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/api/package.json /app/api/package-lock.json ./api/
COPY --from=build /app/api/node_modules ./api/node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/prisma ./api/prisma

# UI dist served by API via UI_DIST_PATH
COPY --from=build /app/ui/dist ./ui-dist

ENV UI_DIST_PATH=/app/ui-dist
ENV PORT=4000
EXPOSE 4000
CMD ["node", "api/dist/index.js"]

