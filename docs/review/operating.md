# Operating a review locally

Run one review end to end against a local git repo. See [pipeline.md](pipeline.md) for what happens inside. See [configuration.md](configuration.md) for every variable.

All commands run from the repository root unless noted. Use `bun`, never `npm` or `pnpm`.

## 1. Install

```sh
bun install
```

The server is `apps/server/src/index.ts`. It reads `PORT` (default 3001), `HOST` (default `0.0.0.0`) and `RECODER_DATA_DIR` (`apps/server/src/env.ts`, `apps/server/src/util/data-dir.ts`).

## 2. Start a server you own

Pick a free port and a fresh data directory. Record the pid. Stop only that pid.

```sh
export RECODER_DATA_DIR=/tmp/recoder-op/data
export PORT=3201
mkdir -p "$RECODER_DATA_DIR"
cd apps/server
bun src/index.ts > /tmp/recoder-op/server.log 2>&1 &
echo $! > /tmp/recoder-op/server.pid
cd ../..
```

Run `bun src/index.ts` directly. A `bun run --filter` wrapper would make the recorded pid the wrapper's.

Check it is up:

```sh
curl -s localhost:3201/health
curl -s localhost:3201/health/identity
```

`GET /health` answers `HealthResponse` (`packages/shared/src/review.ts`). `GET /health/identity` answers the flags, limits and code hash a benchmark records (`apps/server/src/routes/health.ts`).

Stop it:

```sh
kill "$(cat /tmp/recoder-op/server.pid)"
```

Never use `pkill` or a pattern kill. Other servers run from the same tree.

## 3. Prepare a local repo

A `local` repo is a git repo on disk plus a simulated forge file. The server reads pull requests from it (`apps/server/src/forge/local/schema.ts`).

- The forge file is named `recoder-forge.json` (`FORGE_FILE`) and lives inside the repo's git dir.
- Its schema is `forgeSchema`: `defaultBranch`, `pulls[]`, `issues[]`.
- Each pull needs `number`, `title`, `body`, `author`, `createdAt`, `state`, `headRef`, `baseRef`, `baseSha`.
- Each pull's head commit must exist as `refs/pull/<N>/head` in the repo. The head sha is always read from that ref (`apps/server/src/forge/local/pulls.ts`).
- Changed files are `git diff baseSha..head`.

A missing forge file or ref reads as a missing pull request.

## 4. Register the repo

```sh
curl -s -X POST localhost:3201/api/repos -H 'content-type: application/json' \
  -d '{"name":"demo","url":"file:///abs/path/to/repo","provider":"local","defaultBranch":"main"}'
```

- The route is `POST /api/repos` (`apps/server/src/routes/repos.ts`).
- A `file://` URL needs `provider: "local"`, and `provider: "local"` needs a `file://` URL. Anything else is a 400.
- The answer holds the repo `id`. A path that is not a git repo is a 400.
- `GET /api/repos/:id/pulls` lists its pull requests.

## 5. Pick a model

A review needs a configured model. Nothing here is offline.

```sh
curl -s localhost:3201/api/settings/models
```

- The answer is the payload built by `settingsPayload` (`apps/server/src/routes/settings.ts`): `configured`, `models[]` (each with an `id`), the chosen model ids and the efforts.
- Connect a provider first with `PUT /api/agent/providers/:id/key` (`apps/server/src/routes/agent.ts`) or `POST /api/settings/providers/:id/connect`, or sign in to an agent CLI the adapters use. Keys are never read back in full.
- Choose the model with `PATCH /api/settings/models` (`PUT` works too). The body is `reviewSettingsSchema` (`apps/server/src/review/session/review-settings.ts`).
- Set `sharedModelId` for one model on every stage. Set `orchestratorModelId` and `specialistModelId` to split them. Set `orchestratorEffort` and `specialistEffort` from `REASONING_EFFORTS` (`packages/shared/src/models.ts`).

```sh
curl -s -X PATCH localhost:3201/api/settings/models -H 'content-type: application/json' \
  -d '{"sharedModelId":"<id from models[]>"}'
```

See [models.md](models.md) for how the pick is locked per run.

## 6. Trigger a review

```sh
curl -s -X POST localhost:3201/api/reviews -H 'content-type: application/json' \
  -d '{"repoId":"<repo id>","prNumber":1}'
```

- `POST /api/reviews` queues a review and answers 201 with a `Review` (`apps/server/src/routes/reviews/lifecycle.ts`).
- `createReviewSchema` takes `repoId`, `prNumber`, and optional `headSha`, `start`, `baselineCache` and `prTitle`.
- `start: false` opens an empty draft session. Start it with `POST /api/reviews/:id/start`.
- `baselineCache: false` reruns every baseline check instead of reusing an earlier result.

Control a running review:

- `POST /api/reviews/:id/cancel` stops it. Findings so far are kept.
- `POST /api/reviews/:id/pause` and `POST /api/reviews/:id/resume`.
- `POST /api/reviews/:id/continue` resumes a failed review from its checkpoint.

## 7. Read the result

Poll until `status` is `passed` or `failed` (`ReviewStatus` in `packages/shared/src/review.ts`).

```sh
curl -s localhost:3201/api/reviews/<id>
```

| Route                                 | Answer                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/reviews/:id`                | `Review`: `status`, `summary`, `findings`, `unconfirmed`, `funnel`, `obligations`, `questions` |
| `GET /api/reviews/:id/candidates`     | every candidate, shown or not, as `Finding & CandidateOutcome` with its `stage`                |
| `GET /api/reviews/:id/metrics/stored` | stored model call records (`apps/server/src/models/metrics.ts`)                                |
| `GET /api/reviews/:id/events`         | server-sent progress events (`apps/server/src/routes/reviews/streams.ts`)                      |
| `GET /api/reviews/:id/files`          | the parsed diff                                                                                |

- `findings` is what a developer sees. `unconfirmed` holds candidates no verifier could prove.
- `funnel` counts candidates by `DropStage`.
- `GET .../candidates` reads the running review's checkpoint, else the one a passed review kept for replay. It is a 404 when none was kept.
- A cancelled review has `status: "failed"` and `summary` equal to `REVIEW_CANCELLED`.

## 8. Replay without reviewers

```sh
curl -s -X POST localhost:3201/api/reviews/<id>/replay -H 'content-type: application/json' -d '{"reverify":false}'
```

- Route: `POST /api/reviews/:id/replay`. Code: `replayReviewSession` in `apps/server/src/commands/rerun.ts`.
- Only a passed review that kept a checkpoint can be replayed. Otherwise the answer is 409.
- The reviewers' candidates and verdicts stay. Detectors, any verification still owed and consolidation run again.
- `reverify: true` clears every verdict and verifies every candidate again. That calls models.
- A replay is the way to measure a change to detectors, validation, verification or consolidation without paying for reviewers.

`POST /api/reviews/:id/rereview` is a different feature: it answers a developer's notes and may add findings to the stored review (`apps/server/src/routes/reviews/chat.ts`).

## 9. Run one benchmark task against the server

Needs a dataset with a `labels/` folder and its forge repos registered. See [evaluation.md](evaluation.md).

```sh
bun run --filter @recoder/server eval:benchmark -- \
  --dataset /path/to/dataset --only <pr-id> --runs 1 --base http://localhost:3201
```

- The CLI starts the reviews through `POST /api/reviews`, polls them, then judges the findings (`apps/server/src/eval/run-review.ts`).
- `--base` defaults to `http://localhost:3001`. Always pass your own port.
- Ctrl-C cancels the reviews the CLI started (`stopOnInterrupt`).
- Rescoring and merging saved reports need no review: `eval:rescore` and `eval:merge` (`apps/server/package.json`).

## 10. Before you finish

- Stop your server by pid.
- Keep the data directory outside the repository.
- Never read or print the settings or token files in the data directory. They hold keys.
