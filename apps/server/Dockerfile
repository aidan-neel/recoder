# ---- Recoder API server (Bun, runs TypeScript directly, no build step) ----
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# git + gh power the PR fetch and sandbox checkouts (public repos work
# without auth; private repos need GH_TOKEN / `gh auth login` at runtime).
RUN apk add --no-cache git github-cli glab

COPY package.json bun.lock* turbo.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN bun install

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
	CMD wget -qO- http://localhost:3001/health > /dev/null || exit 1
CMD ["bun", "apps/server/src/index.ts"]
