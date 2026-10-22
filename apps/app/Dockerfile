# ---- Recoder review app (Next.js standalone output) ----
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/app/package.json ./apps/app/
RUN bun install

COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/app ./apps/app

# The browser calls the server directly, so its URL is baked into the bundle.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/app
RUN bun run build

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Docker sets HOSTNAME to the container id; the server must listen on every interface.
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=bun:bun /app/apps/app/.next/standalone ./
COPY --from=build --chown=bun:bun /app/apps/app/.next/static ./apps/app/.next/static

USER bun
EXPOSE 3000
CMD ["bun", "apps/app/server.js"]
