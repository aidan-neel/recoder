# Recoder

Self-hosted, OpenCode-style pull request reviewer. Runs anywhere Docker runs.

![Recoder session view](assets/session.png)

## Quickstart

```sh
bun install
bun run dev        # web on :5173, server on :3001 (turbo runs both)
```

Or fully self-hosted:

```sh
cp .env.example .env
docker compose up --build
# web -> http://localhost:3000, api -> http://localhost:3001
```

## PR fetching & sandboxes

Queued reviews fetch live PR data through the `gh` CLI (metadata + unified
diff), then check the PR head out into an isolated sandbox:

```
$RECODER_WORKDIR/repos/<owner>__<repo>__pr-<n>/
```

- Public repos work with no auth; private repos need `GITHUB_TOKEN` (or `gh auth login`).
- Without `gh`/auth the pipeline keeps working in **stub mode** (demo steps, no clone).
- Never executes PR code on the host: review commands run through the allowlisted runner (`RECODER_ALLOWED_COMMANDS`), and tokens are never embedded in clone URLs (they would leak into run logs).

## Reviewer harness (custom, read-only)

No OpenCode/agent-execution here — a purpose-built harness sends the diff +
sandbox excerpts to role-specific models and parses strict-JSON findings:

- Any OpenAI-compatible endpoint: vLLM, OpenRouter, or DashScope. Configure
  `RECODER_REVIEW_BASE_URL` + `RECODER_REVIEW_API_KEY` + `RECODER_REVIEW_MODEL`
  (e.g. a Qwen coder model), with optional per-role overrides
  (`RECODER_SECURITY_MODEL`, `RECODER_PERF_MODEL`, …).
- Roles run in parallel: `security`, `perf`, `correctness`, `docs`.
- Without model config the pipeline stays in stub mode (demo steps).
- Progress streams over SSE: `GET /api/reviews/:id/events`.
- Model settings live behind the gear icon (or `PUT /api/settings/models`);
  stored in `$RECODER_DATA_DIR/review-config.json` (0600), overriding env.

## Auth persistence

UI-connected provider tokens persist to `$RECODER_DATA_DIR/tokens.json`
(0600, same tradeoff as the gh CLI's own storage) so reconnects survive
restarts and hot reloads. The default directory is `~/.recoder/data`,
independent of the server's working directory. Tokens stay saved until explicitly
disconnected; expired or revoked tokens must be replaced. Saves are atomic, and
failed saves return an error. Process env (`GH_TOKEN`/`GITLAB_TOKEN`) takes precedence when set.
Backed by the `recoder-data` volume in compose.

GitHub reviews fetch PR metadata, clone into a separate checkout per review,
and compute the merge-base diff with local Git. They do not use GitHub's
size-limited PR diff endpoint. Specialist agents and their scouts receive
local diff and checkout excerpts; large file lists are reviewed in batches.
Checkouts are read-only inputs to the review harness, not OS-level containers.
Model inference still uses the endpoint configured in settings.

## Durable state (SQLite)

Tracked repos, reviews, command runs, and fetched diffs live in
`$RECODER_DATA_DIR/recoder.db` (WAL mode) — restarts and hot reloads no
longer wipe sessions. Reviews orphaned mid-run by a restart are marked
failed on boot with a retry hint instead of spinning forever.

## API (server :3001)

| Method | Path                    | Description                              |
| ------ | ----------------------- | ---------------------------------------- |
| GET    | `/health`               | liveness probe                           |
| GET    | `/api/repos`            | list tracked repos                       |
| POST   | `/api/repos`            | track a repo `{ name, url }`             |
| DELETE | `/api/repos/:id`        | untrack a repo                           |
| GET    | `/api/auth/status`      | gh/glab availability + auth state        |
| POST   | `/api/auth/token`       | validate + store a PAT `{provider,token}`|
| DELETE | `/api/auth/token/:provider` | forget a stored PAT                  |
| GET    | `/api/auth/repos?provider=` | your repos on a provider             |
| GET    | `/api/reviews`          | list reviews                             |
| POST   | `/api/reviews`          | queue a review `{ repoId, prNumber }`    |
| GET    | `/api/reviews/:id`      | review detail (status, findings, runs)   |
| GET    | `/api/reviews/:id/files`| parsed unified diff (404 until fetched)  |
| GET    | `/api/runs` `/runs/:id` | command run logs                         |
| POST   | `/api/webhooks/github`  | GitHub `pull_request` webhook (HMAC)     |

## Layout

```
apps/web        SvelteKit frontend (adapter-node, self-hostable)
apps/server     Bun API + gh fetching + sandboxes + command runner
packages/shared shared API types + unified-diff parser
```

## Environment

| Var                          | Default                    | Purpose                        |
| ---------------------------- | -------------------------- | ------------------------------ |
| `PUBLIC_API_URL`             | `http://localhost:3001`    | web → api (browser)            |
| `FRONTEND_URL`               | `http://localhost:3000`    | server links/CORS              |
| `PORT` / `HOST`              | `3001` / `0.0.0.0`         | server bind                    |
| `GITHUB_TOKEN`               | (unset)                    | `gh` auth for private repos    |
| `GITLAB_TOKEN`               | (unset)                    | `glab` auth (or connect in UI) |
| `GITHUB_WEBHOOK_SECRET`      | (unset = accept unsigned)  | webhook HMAC                   |
| `RECODER_ALLOWED_COMMANDS`   | `echo,git,gh,bun`          | command runner allowlist       |
| `RECODER_WORKDIR`            | `/tmp/recoder-work`        | sandbox checkouts + run cwd    |
| `RECODER_COMMAND_TIMEOUT_MS` | `120000`                   | per-command timeout            |

## UI

SvelteKit + Tailwind CSS v4 + [Sivir UI](https://sivir.dev) (`@sivir-ui/svelte`,
Midnight Ledger theme). Per the [Sivir guide](https://sivir.dev/llms.txt), check
the live component pages before adding new components.
