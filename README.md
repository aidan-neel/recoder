<h1>
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="packages/ui/src/brand/recoder-lockup-dark.svg" />
		<img alt="Recoder" src="packages/ui/src/brand/recoder-lockup-light.svg" height="56" />
	</picture>
</h1>

A self-hosted pull request reviewer.

![Recoder](assets/screenshot.png)

## Run

```sh
bun install
bun run dev
```

The app opens at http://localhost:5180 and the server listens on port 3001. `bun run dev:web` runs the SvelteKit app (`apps/web`) in its place.

Or with Docker:

```sh
cp .env.example .env
docker compose up --build --remove-orphans
```

The app and API share http://localhost:3001. Set `PORT` to change the host port, or set `RECODER_PUBLIC_URL` to your public HTTPS origin when using a reverse proxy. Neither requires an image rebuild. The Compose command also removes the old separate app container when upgrading from a two-container install; it keeps the existing data volumes.

Configuration lives in [`.env.example`](.env.example).

For Kubernetes, use the [Helm chart](charts/recoder/README.md). It deploys one API server with persistent data and the review app.

For multiple API replicas, configure shared PostgreSQL storage. See [HA operation and migration](docs/ha-operating.md).

Recoder can review pull requests on its own when someone comments `@recoder` on them: see [docs/auto-review.md](docs/auto-review.md).

The review pipeline is documented stage by stage for agents in [docs/review](docs/review/README.md).

You can run the same review from a terminal with the `recoder` command: `recoder init` sets it up for your coding agents, and `recoder review` prints the report where you work. Agents pass `-p` for JSON, or use the MCP tools of `recoder mcp`. None of it needs the server: see [docs/review/cli.md](docs/review/cli.md).
