# ---- Recoder web frontend (SvelteKit, adapter-node) ----
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY . .
RUN bun install

ARG PUBLIC_API_URL=http://localhost:3001
ENV PUBLIC_API_URL=${PUBLIC_API_URL}
WORKDIR /app/apps/web
RUN bun run build

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/apps/web/build ./build
COPY --from=build /app/apps/web/package.json ./

EXPOSE 3000
CMD ["bun", "./build/index.js"]
