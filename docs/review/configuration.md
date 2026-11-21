# Server Configuration

The server reads the environment variables below. All are optional. An unset variable takes the default listed here.

`GET /health/identity` (`serverIdentity` in `apps/server/src/eval/server-identity.ts`) reports every set `RECODER_*` variable as a flag. It leaves out the names in `NOT_FLAGS` and any name ending in `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD`, `_URL`, `_BIN`, `_DIR` or `_PATH`. It reports the four `RECODER_SANDBOX_*` variables apart, under the host.

## Experiment flags, kill switches and tuning knobs

- **Experiment flags.** Off unless set to `1`. With the flag unset, the review must behave exactly as before the feature existed (flag-off parity, see [README.md](README.md)). There are seven: `RECODER_OBLIGATIONS`, `RECODER_OBLIGATIONS_NEW_CODE`, `RECODER_OBLIGATIONS_TRANSITIONS`, `RECODER_TEST_STRENGTH`, `RECODER_CALLER_SELECTION`, `RECODER_RESIDUAL`, `RECODER_CONTRACT_CHECKS`. `RECODER_REVIEW_VARIANT` is the experiment flag that takes a name instead of `1`. No other variable is an opt-in flag. `RECODER_REVIEWER_TOOLS` is a setting with a default, not a flag.
- **Kill switches.** On by default. Setting one turns a stage off: `RECODER_EXEC=off`, `RECODER_OVERLAY=off`, `RECODER_LANES=off`, `RECODER_BASELINE_CACHE=off`, `RECODER_PACKAGE_PREP=0`, `RECODER_CANDIDATE_REPAIR=0`. Any other value leaves the stage on.
- **Tuning knobs.** Every other variable. They size, place or credential work and do not add or remove a stage.

**RECODER_SKIP_UNUSED_EXPORTS**: Experimental ablation, off by default. Set to `1` to skip the deterministic added-export/no-external-reference heuristic, which cannot establish whether a library's public API has external consumers. It also suppresses genuine orphan exports from this detector. Compiler diagnostics, model findings and all other detectors are unchanged.

**RECODER_PRECISION_FIXES**: Experimental detector-only policy, off by default. Set to `1` to identify replaced declarations against the merge base before calling them new exports and exempt convention-discovered test entrypoints. Missing base symbols on modified files fail closed rather than inventing new exports. Genuinely new unused exports remain eligible. Verification, proof reuse and deterministic consolidation are unchanged; differently stated verified claims keep their own proofs and publication. There is no semantic publication-deduplication stage.

**RECODER_DEPENDENCY_GROUNDING**: Experimental verifier context, off by default. Set to `1` to attach bounded, versioned declarations/source before investigating external API claims. A read-only inspector runs inside the existing sandbox: Node resolution uses the nearest installed `node_modules` package metadata, Python uses checkout virtualenv `dist-info` metadata (including import aliases), and Go uses exact `go.mod` require/replace versions in the sandbox module cache. Exact npm/Python pins are checked where present; installed metadata, not a guessed latest version, identifies other resolved versions. No network, package installation or project imports are performed. Symlink/path escapes, mismatched versions, unavailable runtimes and missing dependencies fail closed as unavailable context, never as confirmation or refutation. Lookups cap source files at 128 KiB each, 2 MiB total reads, three packages, six source files per package, a 16 KiB JSON attachment and five seconds. Excerpts are explicitly incomplete. The attachment is not proof or a verifier-owned run: evidence ids, verdict settlement, action/operation limits and publication rules are unchanged. F's flag-off verifier payload and execution path are unchanged.

**RECODER_DEVIN_MCP_ONLY**: On by default for Devin verifier sessions. Set to `0` to opt out of hiding CLI-local tools via `disabled_tools` and disabling subagents. Recoder-owned pre-tool hooks refuse stale local calls with the leased MCP equivalent; existing permission denies remain in place. Requires a Devin CLI supporting `disabled_tools` and command hooks. Other stages, tool-free calls, sandbox permissions and verification verdict rules are unchanged.

**RECODER_VERIFIER_SESSION_FIXES**: On by default. Set to `0` to restore legacy per-step quotas and fuzzy proof sharing. Opaque CLIs (currently Devin) receive session allowances: four operations per configured tool turn, across prompts and retries, instead of per-inference quotas the adapter cannot observe. Explicit operation caps still apply; deadline, role and sandbox gates remain. Exhaustion forces answer-only finalization, never refutation. Verification reuse and verified consolidation require identical explicit claims (or exact title/body when absent), preferring duplicate reports over losing a proved claim. Set this to `0` with MCP-only routing still on to reproduce Iteration-3 E; set both flags to `0` for legacy routing too.

## Model fallback

Saved model settings win. These variables are the fallback, read by `effectiveReviewEnv` in `apps/server/src/review/session/review-settings.ts`.

**RECODER_REVIEW_BASE_URL**: OpenAI-compatible endpoint, for example `https://openrouter.ai/api/v1`. Used when no base URL is saved. A saved entry with no base URL of its own also uses it. Default empty. When either pick fails to resolve, a review cannot start (`isReviewConfigured` in `apps/server/src/models/models.ts`).

**RECODER_REVIEW_API_KEY**: Key for that endpoint. Used when no key is saved. Default empty; local servers often need no key.

**RECODER_REVIEW_MODEL**: Model id on that endpoint. Used only when no model entry is saved. Default empty.

## Context window

Every model runs with a context window: the most tokens (prompt and output) one request to it may spend. A window is set per model in Settings and saved in `contextWindows` in the settings file, keyed by the model id a pick uses (`opencode:openai/gpt-6.1-terra`, a saved entry's id, `vllm:<server>/<model>`, `claude-code:opus`). A patch (`PUT`/`PATCH /api/settings/models`) merges its `contextWindows` map into the saved one; a `null` value removes that model's key. A value must be an integer between 16000 and 1000000; anything else is refused. `GET /api/settings/models` returns the saved map as `contextWindows`, and each entry of `models` carries the user's value as `contextWindowSet` next to the reported `contextWindow`, so the picker can show the two apart.

`contextWindowFor` in `apps/server/src/models/models.ts` resolves the window every `ModelConfig` carries: the user's setting for the model wins, then the window its provider, agent CLI or catalog reports (a saved entry's own `contextWindow`, the agent's model list, a vLLM capture, a hosted catalog), else `DEFAULT_CONTEXT_WINDOW` (128000) from `packages/shared/src/models.ts`. A reported or saved window that is not a positive number counts as unset. The review pipeline reads the resolved window to size prompts.

## Review limits

Read by `effectiveReviewEnv`. A saved value wins. A value that is not a positive number falls back to the default.

**RECODER_REVIEW_MAX_FILE_CHARS**: Default 12000. Caps the characters one file read returns to a model. Passed to `EvidenceStore` in `apps/server/src/review/pipeline/harness/context.ts`.

**RECODER_REVIEW_MAX_FILES**: Default 200. Caps how many reviewable files one review covers (`applyDiffLimits` in `apps/server/src/review/pipeline/harness/diff-limits.ts`, called from `createRun` in `context.ts`). Files past the limit are excluded with `exceeds maxFiles limit (N)` and recorded in `ReviewContext.omitted` (`reason: 'file-cap'`) and `CoverageLedger`.

**RECODER_REVIEW_MAX_DIFF_CHARS**: Default 600000. Caps total patch characters across the reviewable files (`applyDiffLimits` in `diff-limits.ts`). Files, hunks or trailing lines past the cap are excluded with `exceeds maxDiffChars limit (N)` and recorded in `ReviewContext.omitted` (`reason: 'diff-cap'`) and `CoverageLedger`.

**RECODER_REVIEW_EXCLUDE**: Comma-separated substrings, matched case-insensitively. A changed path containing one is excluded from the review with the reason `matches RECODER_REVIEW_EXCLUDE`. Read by `extraExcludes` in `apps/server/src/review/pipeline/review-scope.ts`. Default empty.

## Model call limits

**RECODER_LLM_CONCURRENCY**: Ceiling on concurrent calls per model endpoint. Each endpoint gets its own ceiling of this size. Default 64. Read by `envCount` in `apps/server/src/models/llm/limiter.ts`. Must be a positive number.

**RECODER_CLAUDE_CODE_CONCURRENCY**: Ceiling for the `claude-code` endpoint, which starts one CLI process per call. Default 8. The effective ceiling is the smaller of this and `RECODER_LLM_CONCURRENCY`. Read through the adapter's `processCeiling` — an `{ env, fallback }` pair each agent declares (`apps/server/src/agents/claude-code/claude-code.ts`) — which `llmCeiling` in `apps/server/src/models/llm/limiter.ts` looks up by the endpoint's provider id. The same shape caps the other process-per-call CLIs: `RECODER_CODEX_CONCURRENCY`, `RECODER_DEVIN_CONCURRENCY`, `RECODER_PI_CONCURRENCY`, `RECODER_GROK_CONCURRENCY`, `RECODER_CURSOR_CONCURRENCY`, `RECODER_ANTIGRAVITY_CONCURRENCY` and `RECODER_COPILOT_CONCURRENCY`, each default 4. `opencode` and `custom-command` declare none and share the endpoint ceiling.

**RECODER_LLM_RETRIES**: Retries after a transient failure. Default 5. Read in `apps/server/src/models/llm/retry.ts`. Non-negative; fractions are floored. A retry also needs time left before the call's deadline.

**RECODER_LLM_IDLE_MS**: A stream with no bytes for this long is aborted as stalled. Default 45000. Values under 1000 fall back to the default. Read in `apps/server/src/models/llm/openai-stream.ts`, so it applies to the OpenAI-compatible streaming transport only.

## Sandbox sizing

Read by `resolveLimits` in `apps/server/src/sandbox/host-load.ts`. Each must be a positive integer, or the default applies. Sandboxed commands run in one of three tiers. `prep` is dependency installs and baseline checks. `run` is every reviewer and verifier command. `light` is housekeeping and takes no slot.

**RECODER_SANDBOX_CPUS**: CPUs sandboxed commands are pinned to with `taskset` (Linux, when `taskset` is installed). Capped at the host's count. Default: all host CPUs minus `max(2, floor(total / 4))`, at least 1.

**RECODER_SANDBOX_RUNS**: Slots for `run`-tier commands across all reviews. Default `max(2, floor(cpus / 2))`, where `cpus` is the sandbox CPU count above.

**RECODER_SANDBOX_PREP**: Slots for `prep`-tier commands across all reviews. Default `max(1, floor(cpus / 4))`.

**RECODER_SANDBOX_MIN_FREE_MB**: A command waits until this much memory is available. Default 1536. Linux only (reads `/proc/meminfo`). After 60 seconds the command runs anyway.

## Kill switches

**RECODER_EXEC**: `off` turns code execution off, so the review stays read-only. Read by `execUnavailableReason` in `apps/server/src/sandbox/exec-sandbox.ts`. Execution also needs bubblewrap on Linux or Seatbelt on macOS.

**RECODER_LANES**: `off` makes agents share the one checkout on macOS too, one command at a time, instead of each running in its own copy. Read by `lanesAvailable` in `apps/server/src/sandbox/checkout-lanes.ts`.

**RECODER_OVERLAY**: `off` turns overlay mounts off. Shared dependency installs are then copied instead of mounted. Read by `overlayUnavailableReason` in `apps/server/src/sandbox/overlay.ts`. Overlays need Linux.

**RECODER_BASELINE_CACHE**: `off` turns off the baseline check cache: results from earlier reviews are neither reused nor stored. Read by `baselineCacheEnabled` in `apps/server/src/review/pipeline/harness/baseline-cache.ts`. The cache lives under the data directory.

**RECODER_PACKAGE_PREP**: `0` skips package prep. Prep runs generation commands and a smoke run in changed packages before investigators run, then tells each investigator run what prep reached. Read by `packagePrepEnabled` in `apps/server/src/review/pipeline/harness/package-prep.ts`.

**RECODER_CANDIDATE_REPAIR**: `0` turns off candidate repair. Repair gives a candidate that fails location or category validation one repair attempt. Read by `candidateRepairOn` in `apps/server/src/review/pipeline/harness/repair.ts`.

**RECODER_REPAIR_CAP**: Most repairs one review makes. Default 8. A non-negative integer; `0` allows none. Read in `apps/server/src/review/pipeline/harness/repair.ts`. Tuning knob.

## Experiment flags

**RECODER_OBLIGATIONS**: `1` turns on obligations. After the change model is built, the review derives obligations from risky changes and queues one investigation per obligation, under a cap. Read by `obligationsOn` in `apps/server/src/review/pipeline/obligations/config.ts`. Off, the review state holds no obligations and the stage does nothing.

**RECODER_OBLIGATION_CAP**: Most investigations one review launches, counted apart from the subagent cap. Default 8. A non-negative integer. Read only when obligations are on.

**RECODER_OBLIGATION_TURNS**: Model turns per investigation. Default 8. An integer is clamped to 3 through 12; anything else gives the default. Read only when obligations are on.

**RECODER_OBLIGATIONS_NEW_CODE**: `1` lets a hunk that only adds lines oblige an investigation. Its truthiness tests, bounds and normalizers fire the truthy-default, boundary and normalization triggers with nothing on the base side to compare. Off, only replaced code fires them. Read by `obligationsNewCodeOn` in `apps/server/src/review/pipeline/obligations/config.ts`. It has no effect unless obligations are on.

**RECODER_OBLIGATIONS_TRANSITIONS**: `1` adds the state-transition trigger (issue #99). A changed line that moves an entity between states derives an obligation: a state field (`status`, `state`, `phase`, `lifecycle`, `jobStatus`…) set or compared, a lease or lifecycle flag written on an object (`leaseUntil`, `lockedBy`, `closed`, `isCancelled`…), and an entry put into or taken out of a cache or queue (`cache.delete`, `jobQueue.push`, `invalidate`, `ack`…). A state field set to a literal counts only when the file gives the field two states or more, and a number is never a state. Read by `obligationsTransitionsOn` in `apps/server/src/review/pipeline/obligations/config.ts`. It has no effect unless obligations are on.

**RECODER_TEST_STRENGTH**: `1` turns on test-strength work. Read by `testStrengthOn` in `apps/server/src/review/pipeline/test-strength.ts`. It adds:

- the matrix stage, which runs the changed tests against mutants (`apps/server/src/review/pipeline/harness/quality-stage.ts`);
- extra weak-test detector shapes under `apps/server/src/review/pipeline/detectors/` (for example an exact check replaced by a lower bound, a test that only checks output is not empty, a test that only counts results);
- AVA's `t.assert` counted as an assertion (`apps/server/src/review/pipeline/detectors/test-source.ts`);
- a larger read limit for test files (`MAX_TEST_BYTES` in `apps/server/src/review/pipeline/detectors/test-files.ts`).

**RECODER_CALLER_SELECTION**: `1` turns on caller selection in the change model. Callers are ranked by how much they depend on the changed behavior, and that behavior is stated next to them. It does not choose models. Read by `buildChangeModel` in `apps/server/src/review/pipeline/change-model/change-model.ts`. A caller can override it with the `callerSelection` input.

**RECODER_RESIDUAL**: `1` turns on the residual pass. After the reviewers answer, each reviewer's slice gets one second-look subagent on the specialist model. It is told what the review already raised (its slice's files first) and the files that usually change with the slice's files but that the change leaves alone (read from the base's git history). It counts inside the subagent cap: it takes only the room the reviewers' requests left, and none runs with subagents off. Read by `residualOn` in `apps/server/src/review/pipeline/second-look/config.ts`.

**RECODER_RESIDUAL_CAP**: Most residual passes one review launches, one per reviewer slice, at most as many as the subagent cap leaves room for. Default 6. A non-negative integer. Read only when the residual pass is on.

**RECODER_CONTRACT_CHECKS**: `1` turns on contract checks. Each valid readability candidate whose smell is `stale-comment`, `misleading-name` or `hidden-side-effect` gets one second-look subagent on the specialist model, which decides whether the comment, name or doc is wrong or the code is. It counts inside the subagent cap. Read by `contractChecksOn` in `apps/server/src/review/pipeline/second-look/config.ts`.

**RECODER_REVIEW_VARIANT**: names an experiment arm of issue #95; unset, the review is the baseline. `independent-pass` adds a second, complete review pass: one more reviewer per slice (`independent-reviewer-N`), with the same scope and lenses, that never sees the first pass's findings. `specialist-tree` asks a coordinator (one orchestrator call) which specialists read which slices, then runs one reviewer per specialist, each applying one lens (`specialist-<lens>`); correctness, security, concurrency, api-contract and rules always read every slice they fit, and each specialist may send at most 3 subagents, inside the subagent cap. `lens-split` gives every slice one reviewer per lens group in place of its one reviewer of every lens: correctness, api-contract, security, concurrency and performance each get their own, and rules, conventions and readability share one (`lensSplitUnits` in `apps/server/src/review/pipeline/variants/lens-split.ts`). It is cut without a model call, so the same change always gives the same reviewers. An empty value is unset; any other value makes the server refuse to start and a review throw. Read by `reviewVariant` in `apps/server/src/env.ts`. It is recorded in `RunIdentity.flags` like every other `RECODER_*` variable, so reports of different arms never compare as equal.

**RECODER_REVIEWER_TOOLS**: names the tools a review's reviewers and subagents get: `none` (the default), `read` or `all`. With no tools a review rests on what the harness hands the model, not on how well the model drives an agent loop. An empty value is unset; any other value makes the server refuse to start and a review throw. Read by `reviewerTools` in `apps/server/src/env.ts`. Verifiers, obligation investigators and workers a verifier starts are not changed: a bug is still proven by a run. Reviewers that run no code (`none` and `read`) start without waiting for the sandbox (`reviewersWaitForSandbox` in `harness/run.ts`).

- `all`: reviewers and subagents have every tool: the reads, the shell, scratch files and workers.
- `read`: reviewers and subagents keep the read tools (`read_diff`, `read_file`, `search`, `list_files`, `load_skill`) and their turns. They get no shell, no scratch files and no workers (`askReviewer` in `apps/server/src/review/pipeline/harness/pool.ts`), and an agent CLI lists only the tools the agent may call (`listedTools` in `agent-loop/native-engine.ts`).
- `none`: a reviewer has no tool and answers in one call. `limitsForReviewerTools` in `apps/server/src/review/pipeline/harness/reviewer-tools.ts` gives each reviewer and subagent one turn and sets `ReviewLimits.sliceChars`, so `reviewerCount` cuts the change into as many slices as keep each within `unitBudgetChars` (24,000 patch characters). The reviewer's opening message holds its whole slice (`openingPatchChars`, up to 40% of the model's context window), its system prompt is `singleCallContract` in `prompts.ts`, and its reasoning may run to `singleCallReasoningChars` before it is cut off. Reviewers are offered no subagents: ones with the read tools were tried under this setting and published no more planted defects for 57% more input tokens. The subagent cap goes to the brief's open questions instead, each answered in one call without tools, so a question no reviewer settled is looked at again rather than left open.

**RECODER_CONTRACT_CHECK_CAP**: Most contract checks one review launches, one per place. Default 4. A non-negative integer. Read only when contract checks are on.

## Data and caches

**RECODER_DATA_DIR**: Directory for the SQLite database, saved settings, forge tokens and caches. Default `~/.recoder/data`. Read by `serverDataDir` in `apps/server/src/util/data-dir.ts`. Do not read the settings or token files in it: they hold keys.

The fact cache is `cache/facts.db` in the data directory. It holds parsed declarations per file blob and merged commit-to-PR answers, for every repository. You can delete it at any time; reviews fill it again. See the glossary.

**RECODER_WORKDIR**: Root for repo checkouts (`<workdir>/repos/...`) and the command runner's default working directory. Default `/tmp/recoder-work`. Parsed in `apps/server/src/env.ts`. Used in `apps/server/src/sandbox/sandbox.ts` and `apps/server/src/review/session/review-checkout.ts`.

**RECODER_REPLAY_BYTES**: Total size of kept replay checkpoints. A passed review keeps its last checkpoint for replay. Past this size the oldest are dropped first. Default 512 MiB. `0` or a non-number gives the default. Read by `keepForReplay` in `apps/server/src/store.ts`.

**RECODER_BRIEF_TTL_MS**: How long the Home brief stays cached on disk before it is rewritten. Default 12 hours. Must be positive. Read in `apps/server/src/home/home-brief.ts`. New PRs and finished reviews do not trigger a rewrite.

## HTTP server

Parsed with zod in `apps/server/src/env.ts`.

**PORT**: Listen port. Default 3001.

**HOST**: Listen address. Default `0.0.0.0`.

**FRONTEND_URL**: The web app's origin. Default `http://localhost:5180`, the port `bun run dev` serves the app on (`apps/app/package.json`). `trustedOrigin` in `apps/server/src/routes/trusted-origin.ts` lets it call routes that sign in or hold credentials. The API's authenticated `GET /` returns it too. CORS allows credentials for the trusted app origin (and for loopback origins outside production), and answers other origins with `*`, which browsers refuse to combine with credentials (`apps/server/src/app.ts`). The session cookie is `SameSite=Lax`, so the app and the API must be on the same site (the same registrable domain; ports may differ, as with `app.example.org:8443` and `app.example.org:8444`, or `localhost:5190` and `localhost:3001`).

**NODE_ENV**: `production` stops `trustedOrigin` from trusting any `http://localhost` or `http://127.0.0.1` origin. Read in `apps/server/src/routes/trusted-origin.ts`.

**GITHUB_WEBHOOK_SECRET**, **GITLAB_WEBHOOK_SECRET**: Required for GitHub or GitLab to deliver events to a claimed server. GitHub sends an HMAC in `X-Hub-Signature-256`; GitLab sends its token in `X-Gitlab-Token`.

**RECODER_GITHUB_CLIENT_ID**, **RECODER_GITLAB_CLIENT_ID**: Client ids of the OAuth applications "Continue with GitHub" and "Continue with GitLab" use. A blank id turns that forge's sign-in off, and the person connects it with a token instead. Scopes asked: `repo read:user read:org` on GitHub, `api read_user` on GitLab. The id works on its own host only, so a self-managed GitLab needs its own application and its own `RECODER_GITLAB_CLIENT_ID`. With the id alone the forge signs in by device code (GitHub: tick "Enable Device Flow"; GitLab: a non-confidential application). Add the secret to sign in by redirect instead.

**RECODER_GITHUB_CLIENT_SECRET**, **RECODER_GITLAB_CLIENT_SECRET**: Client secrets of the same applications. With id and secret a forge signs in by redirect: the browser goes to the forge, the person presses Authorize, and the browser comes back signed in (authorization code with PKCE, `GET /api/auth/oauth/<provider>/start` and `/callback`). The secret is never logged or sent to the browser. On GitLab the application must be confidential. Register this callback URL on the application (GitHub: "Authorization callback URL"; GitLab: "Redirect URI"):

- `https://<api host>/api/auth/oauth/github/callback`
- `https://<api host>/api/auth/oauth/gitlab/callback`

**RECODER_PUBLIC_URL**: The address people reach the API at, such as `https://recoder.example.ts.net`. The callback URL is built from it. Unset, the server builds it from the request's own host, with `https` when the request or its proxy (`X-Forwarded-Proto`) says so; set it when a proxy changes the host. The URL sent to the forge must match the registered one exactly. When `FRONTEND_URL` is unset, the setup-code log prints this address, since it is where the app is reached once one image serves it.

**RECODER_API_TOKEN**: A fixed bearer token (32 to 200 characters) for programs that call the API without a browser, such as `eval:benchmark`, once an account exists. Unset, the server keeps a random one in `api-token` in the data dir (mode 0600, not sealed, since the eval tools read it from there). With shared PostgreSQL there is no shared data dir, so replicas accept a bearer token only when this is set.

**RECODER_SECRET_KEY**: The key that seals every credential the server saves, 32 random bytes as base64. Make one with `openssl rand -base64 32`. Required when `RECODER_DATABASE_URL` is set, since every replica must open what another sealed; the server refuses to start without it. A key that is not 32 bytes of base64 is refused. Unset on a single server, the server makes a key on first start and keeps it in `$XDG_CONFIG_HOME/recoder/secret.key`, else `~/.config/recoder/secret.key` (mode 0600, in a 0700 directory), outside the data folder. The start-up log says in one line where the key comes from, and never shows it. In a container whose home or `/tmp` is not kept, set the variable; a key file that is lost with the container leaves the saved credentials unreadable. The Compose file keeps the key file in its own `recoder-config` volume. Read in `apps/server/src/secrets/secret-key.ts`.

## Stored credentials

Every credential Recoder saves is sealed with AES-256-GCM (`apps/server/src/secrets/seal.ts`): the forge tokens, the API keys of hosted model providers, of custom model endpoints and of vLLM servers, GitLab refresh tokens, and the verifier of a sign-in in progress. A sealed value reads `enc:v1:<base64>`. Each value has its own random IV, and its purpose (`forge-token:github`, `vllm-key:<server id>`) is authenticated with it, so a value copied into another field does not open. A value that was changed, or that was sealed with another key, stops the server from starting or fails the request that needs it, with an error that names the purpose and never the value.

Credentials saved before sealing existed are read as they are and sealed on the next start: `tokens.json`, `review-config.json` and `vllm-servers.json` in the data dir, the same settings in PostgreSQL, and the GitLab refresh token on the account. No step is needed. The old bytes are not wiped from the disk blocks the filesystem freed; SQLite zeroes what it deletes (`secure_delete`). If an old disk or backup may have been exposed, rotate those tokens at the forge.

The API only says that a key is set (`apiKeySet`). It never returns a key or a part of one, and the sessions, setup grants and sign-in states are stored as hashes.

What this protects, and what it does not: anyone who reads the data folder, the database, a backup or the logs sees only sealed values. Someone who can read the key and the data can open them, and so can anyone who can run code as the server. With the key file on the same machine, the key and the data are one root compromise apart. Keeping the key in `RECODER_SECRET_KEY`, from a secret store, keeps it off the disk. The server still passes a forge token to `gh`, `glab` and `git` in the child's environment while it runs them, and a model provider key goes in the request to the provider; both are needed to do the work. The agent CLIs keep their own logins in their own folders (for example OpenCode's `auth.json`), which Recoder does not control. Two files are not sealed because they exist to be read: `setup-code` (a one-time code, removed once an account exists) and `api-token` (the local bearer token that `eval:benchmark` and the CLI read; set `RECODER_API_TOKEN` from a secret store instead).

To move a standalone install to PostgreSQL, set `RECODER_SECRET_KEY` to the contents of the source's `secret.key`, so the sealed values in its files open. Any value still in plaintext is sealed under it.

## Accounts

On a fresh server, only the bundled app, liveness and readiness, sign-in state, and the claim step are public. The rest of the API requires a setup grant or a direct loopback socket without proxy headers (including Tailscale user headers). A reverse proxy on the same machine must forward client information, for example `X-Forwarded-For`, so its requests are not mistaken for local access.

From anywhere else, enter the setup code at `POST /api/auth/setup`. The server prints the code in its log and keeps it in `setup-code` in the data dir (mode 0600) until the first sign-in. A correct code issues a 15-minute `recoder_setup` cookie. With shared PostgreSQL the first replica stores the code's hash for all replicas and is the only one that prints it and writes the file. A wrong code is limited to 5 tries a minute per peer and 10 in all, per replica.

Signing in with GitHub or GitLab, pasting a forge token, or adopting a saved connection creates the first admin account and claims the server. Claim retires the setup grant; even loopback requests now need an authenticated session or the machine API bearer token. The sign-in routes still let a signed-out person get a session by forge redirect, device flow, or token. Direct loopback can also sign into the account that owns a saved connection, without changing the connection. Health and readiness stay public, and forge webhooks can authenticate with their configured webhook secrets instead of a session.

Sign-in is open: anyone who can reach the server and signs in with their own GitHub or GitLab becomes a member. The admin sees the members on the Admin page. A member's token is never saved, so a member's sign-in never changes the forge connection the server reads pull requests with. Members use reviews, chats, pull requests, repositories and guidelines. Only the admin changes `/api/settings/*`, `/api/agent/*` writes, `DELETE /api/auth/token/:provider` and the members (`GET`, `DELETE /api/members`); a member gets 403 `admin-only`. Removing a member ends its sessions and blocks that forge user from signing in again; the admin cannot be removed. Data from before roles existed loads as the admin. Sessions last 30 days from last use and 90 days at most. GitLab tokens expire after about two hours, so a background job renews them before they do.

## Command runner

`runCommand` in `apps/server/src/commands/runner.ts` runs host binaries such as `git`, `gh` and `glab` (argv only, never a shell). It is not the code-execution sandbox.

**RECODER_ALLOWED_COMMANDS**: Comma-separated binaries the runner may start. Default `echo,git,gh,glab,bun`. Any other command is rejected.

**RECODER_COMMAND_TIMEOUT_MS**: Timeout for a run whose caller sets none. Default 120000.

## Forge credentials

**GH_TOKEN**: GitHub token. It wins over a token saved from the UI (`getToken` in `apps/server/src/forge/tokens.ts`).

**GITHUB_TOKEN**: GitHub token for REST calls when neither `GH_TOKEN` nor a saved token exists (`githubToken` in `apps/server/src/forge/github-rest.ts`). Public repos work without any token.

**GITLAB_TOKEN**: GitLab token. It wins over a token saved from the UI (`getToken` in `apps/server/src/forge/tokens.ts`).

**GITLAB_HOST**: Self-managed GitLab host. It wins over a host saved from the UI (`getGitlabHost` in `apps/server/src/forge/gitlab-host.ts`). A repo URL's own host wins over both. Unset, the host is `gitlab.com`.

`tokenEnv` in `apps/server/src/forge/tokens.ts` passes the token (and for GitLab, the host) to forge CLI calls. Local `file://` repos need none of these.

## Agent CLI paths

Resolved by `findCli` in `apps/server/src/agents/cli-process.ts`. When the variable is set, only that path is used: an empty or missing path means no CLI. Unset, the server tries `PATH`, then the installer's location under `HOME`.

**RECODER_OPENCODE_BIN**: OpenCode binary. Fallback `~/.opencode/bin/opencode`. Read by `findOpenCode` in `apps/server/src/agents/opencode/opencode-server.ts`.

**RECODER_CLAUDE_CODE_DEBUG_DIR**: When set, a failed `claude-code` call writes its raw `stream-json` lines (text and thinking deltas left out) to a file in this directory. Unset by default, which keeps nothing. Read in `apps/server/src/agents/claude-code/claude-code-debug.ts`.

**RECODER_CLAUDE_BIN**: Claude Code binary. Fallback `~/.local/bin/claude`. Read in `apps/server/src/agents/claude-code/claude-code.ts`.

**RECODER_CODEX_BIN**: Codex binary. Fallback `~/.local/bin/codex`. Read in `apps/server/src/agents/codex/codex.ts`.

**RECODER_COPILOT_BIN**: GitHub Copilot binary. Fallback `~/.local/bin/copilot`. Read in `apps/server/src/agents/copilot/copilot.ts`.

**RECODER_CURSOR_BIN**: Cursor `cursor-agent` binary. Fallback `~/.local/bin/cursor-agent`. Read in `apps/server/src/agents/cursor/cursor.ts`.

**RECODER_DEVIN_BIN**: Devin binary. Fallback `~/.local/bin/devin`. Read in `apps/server/src/agents/devin/devin.ts`.

**RECODER_GROK_BIN**: Grok Build binary. Fallback `~/.grok/bin/grok`. Read in `apps/server/src/agents/grok/grok.ts`.

**RECODER_PI_BIN**: Pi binary. Fallback `~/.local/bin/pi`. Read in `apps/server/src/agents/pi/pi.ts`.

**RECODER_ANTIGRAVITY_BIN**: Antigravity `agy` binary. Fallback `~/.local/bin/agy`. Read in `apps/server/src/agents/antigravity/antigravity.ts`.

**RECODER_CUSTOM_AGENT**: A JSON `{"argv": [...], "name"?, "maxOutputBytes"?}` naming the command the custom-command adapter runs, never through a shell. Unset, the adapter is not configured. Read by `readCustomCommand` in `apps/server/src/agents/custom/custom-config.ts`.

The Claude Code CLI does not inherit `RECODER_*`, `ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*` other than `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `DISABLE_PROMPT_CACHING*`, `ENABLE_PROMPT_CACHING*`, `MAX_THINKING_TOKENS`, `DISABLE_INTERLEAVED_THINKING`, `DISABLE_COMPACT`, `DISABLE_AUTO_COMPACT`, or any token, key, secret or password variable (`claudeCodeEnv` in `apps/server/src/agents/claude-code/claude-code-process.ts`). It reads no settings file, so a settings `env` block cannot set them either.
