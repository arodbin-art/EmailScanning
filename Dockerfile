FROM node:20-bullseye-slim AS deps
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-bullseye-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/ops/entrypoint.sh /app/ops/entrypoint.sh
RUN chmod +x /app/ops/entrypoint.sh
ENTRYPOINT ["/app/ops/entrypoint.sh"]
CMD ["node", "dist/ingestion/index.js"]
