FROM oven/bun:1.4.4-alpine AS workspace
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/app/package.json ./apps/app/
COPY apps/server/package.json ./apps/server/
COPY apps/site/package.json ./apps/site/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/

FROM workspace AS export
RUN bun install --frozen-lockfile --filter @recoder/app --filter @recoder/shared --filter @recoder/ui
COPY apps/app ./apps/app
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
ENV NEXT_OUTPUT=export
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --filter @recoder/app build

FROM workspace AS runtime
RUN apk add --no-cache git github-cli glab
RUN bun install --frozen-lockfile --production --filter @recoder/server --filter @recoder/shared
COPY apps/server/src ./apps/server/src
COPY packages/shared ./packages/shared
COPY --from=export /app/apps/app/dist ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV RECODER_APP_DIR=/app/public
ENV RECODER_DATA_DIR=/app/data
ENV XDG_CONFIG_HOME=/app/config
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
	CMD wget -qO- "http://127.0.0.1:${PORT}/health/ready" > /dev/null || exit 1
CMD ["bun", "apps/server/src/index.ts"]
