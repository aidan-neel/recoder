# Recoder

A self-hosted pull request reviewer.

![Recoder](assets/screenshot.png)

## Run

```sh
bun install
bun run dev
```

Or with Docker:

```sh
cp .env.example .env
docker compose up --build
```

Configuration lives in [`.env.example`](.env.example).

The review pipeline is documented stage by stage for agents in [docs/review](docs/review/README.md).
