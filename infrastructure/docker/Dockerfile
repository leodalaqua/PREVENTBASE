# PreventBase — imagens Node (api, worker, web) a partir do monorepo pnpm.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig*.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/permissions/package.json packages/permissions/
COPY packages/database/package.json packages/database/
COPY packages/caepi/package.json packages/caepi/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/web apps/web
RUN pnpm --filter @preventbase/database generate \
  && pnpm -r --filter=./packages/* build \
  && pnpm --filter @preventbase/api build \
  && pnpm --filter @preventbase/worker build \
  && pnpm --filter @preventbase/web build

FROM base AS node-runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN rm -rf /app/apps/web
USER node

FROM node-runtime AS api
EXPOSE 3000
CMD ["sh", "-c", "cd packages/database && node_modules/.bin/prisma migrate deploy && node dist/seed-cli.js && cd /app && exec node --enable-source-maps apps/api/dist/main.js"]

FROM node-runtime AS worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "apps/worker/healthcheck.mjs"]
CMD ["node", "--enable-source-maps", "apps/worker/dist/main.js"]

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
