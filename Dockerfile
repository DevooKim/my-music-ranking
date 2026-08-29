FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install --global bun@1.4.0
RUN bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install --yes --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nextjs \
  && useradd --create-home --system --uid 1001 --gid nextjs nextjs
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=builder --chown=nextjs:nextjs /app/scripts/duckdb-httpfs-smoke.cjs ./scripts/duckdb-httpfs-smoke.cjs
RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh
USER root
RUN gosu nextjs node scripts/duckdb-httpfs-smoke.cjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
