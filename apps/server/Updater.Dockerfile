FROM oven/bun:1.4.4-alpine
WORKDIR /app

RUN apk add --no-cache cosign
COPY package.json bun.lock ./
COPY apps/app/package.json ./apps/app/
COPY apps/server/package.json ./apps/server/
COPY apps/site/package.json ./apps/site/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile --production --filter @recoder/server --filter @recoder/shared
COPY apps/server/src/update/container ./apps/server/src/update/container
COPY apps/server/src/cli/upgrade/release-tag.ts ./apps/server/src/cli/upgrade/release-tag.ts
COPY apps/server/src/cli/exit.ts ./apps/server/src/cli/exit.ts
COPY apps/server/src/util/same-secret.ts ./apps/server/src/util/same-secret.ts
CMD ["bun", "apps/server/src/update/container/sidecar.ts"]
