# Server Configuration

The server reads the environment variables below. All are optional. An unset variable takes the default listed here.

`GET /health/identity` (`serverIdentity` in `apps/server/src/eval/server-identity.ts`) reports every set `RECODER_*` variable as a flag. It leaves out the names in `NOT_FLAGS` and any name ending in `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD`, `_URL`, `_BIN`, `_DIR` or `_PATH`. It reports the four `RECODER_SANDBOX_*` variables apart, under the host.

## Experiment flags, kill switches and tuning knobs

- **Experiment flags.** Off unless set to `1`. With the flag unset, the review must behave exactly as before the feature existed (flag-off parity, see [README.md](README.md)). There are three: `RECODER_OBLIGATIONS`, `RECODER_TEST_STRENGTH`, `RECODER_CALLER_SELECTION`. No other variable is an opt-in flag.
- **Kill switches.** On by default. Setting one turns a stage off: `RECODER_EXEC=off`, `RECODER_OVERLAY=off`, `RECODER_BASELINE_CACHE=off`, `RECODER_PACKAGE_PREP=0`, `RECODER_CANDIDATE_REPAIR=0`. Any other value leaves the stage on.
- **Tuning knobs.** Every other variable. They size, place or credential work and do not add or remove a stage.

## Model fallback

Saved model settings win. These variables are the fallback, read by `effectiveReviewEnv` in `apps/server/src/review/session/review-settings.ts`.

**RECODER_REVIEW_BASE_URL**: OpenAI-compatible endpoint, for example `https://openrouter.ai/api/v1`. Used when no base URL is saved. A saved entry with no base URL of its own also uses it. Default empty. When either pick fails to resolve, a review cannot start (`isReviewConfigured` in `apps/server/src/models/models.ts`).

**RECODER_REVIEW_API_KEY**: Key for that endpoint. Used when no key is saved. Default empty; local servers often need no key.

**RECODER_REVIEW_MODEL**: Model id on that endpoint. Used only when no model entry is saved. Default empty.

## Review limits

Read by `effectiveReviewEnv`. A saved value wins. A value that is not a positive number falls back to the default.

**RECODER_REVIEW_MAX_FILE_CHARS**: Default 12000. Caps the characters one file read returns to a model. Passed to `EvidenceStore` in `apps/server/src/review/pipeline/harness/context.ts`.

**RECODER_REVIEW_MAX_FILES**: Default 20. Returned in `limits` by `GET /api/settings/models`. No pipeline code reads it.

**RECODER_REVIEW_MAX_DIFF_CHARS**: Default 60000. Returned in `limits` by `GET /api/settings/models`. No pipeline code reads it.

**RECODER_REVIEW_EXCLUDE**: Comma-separated substrings, matched case-insensitively. A changed path containing one is excluded from the review with the reason `matches RECODER_REVIEW_EXCLUDE`. Read by `extraExcludes` in `apps/server/src/review/pipeline/review-scope.ts`. Default empty.

## Model call limits

**RECODER_LLM_CONCURRENCY**: Ceiling on concurrent calls per model endpoint. Each endpoint gets its own ceiling of this size. Default 64. Read by `envCount` in `apps/server/src/models/llm/limiter.ts`. Must be a positive number.

**RECODER_CLAUDE_CODE_CONCURRENCY**: Ceiling for the `claude-code` endpoint, which starts one CLI process per call. Default 8. The effective ceiling is the smaller of this and `RECODER_LLM_CONCURRENCY`. Read by `envCount` through `PROCESS_CEILINGS` in `apps/server/src/models/llm/limiter.ts`.

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

**RECODER_OVERLAY**: `off` turns overlay mounts off. Shared dependency installs are then copied instead of mounted. Read by `overlayUnavailableReason` in `apps/server/src/sandbox/overlay.ts`. Overlays need Linux.

**RECODER_BASELINE_CACHE**: `off` turns off the baseline check cache: results from earlier reviews are neither reused nor stored. Read by `baselineCacheEnabled` in `apps/server/src/review/pipeline/harness/baseline-cache.ts`. The cache lives under the data directory.

**RECODER_PACKAGE_PREP**: `0` skips package prep. Prep runs generation commands and a smoke run in changed packages before investigators run, then tells each investigator run what prep reached. Read by `packagePrepEnabled` in `apps/server/src/review/pipeline/harness/package-prep.ts`.

**RECODER_CANDIDATE_REPAIR**: `0` turns off candidate repair. Repair gives a candidate that fails location or category validation one repair attempt. Read by `candidateRepairOn` in `apps/server/src/review/pipeline/harness/repair.ts`.

**RECODER_REPAIR_CAP**: Most repairs one review makes. Default 8. A non-negative integer; `0` allows none. Read in `apps/server/src/review/pipeline/harness/repair.ts`. Tuning knob.

## Experiment flags

**RECODER_OBLIGATIONS**: `1` turns on obligations. After the change model is built, the review derives obligations from risky changes and queues one investigation per obligation, under a cap. Read by `obligationsOn` in `apps/server/src/review/pipeline/obligations/config.ts`. Off, the review state holds no obligations and the stage does nothing.

**RECODER_OBLIGATION_CAP**: Most investigations one review launches, counted apart from the subagent cap. Default 8. A non-negative integer. Read only when obligations are on.

**RECODER_OBLIGATION_TURNS**: Model turns per investigation. Default 8. An integer is clamped to 3 through 12; anything else gives the default. Read only when obligations are on.

**RECODER_TEST_STRENGTH**: `1` turns on test-strength work. Read by `testStrengthOn` in `apps/server/src/review/pipeline/test-strength.ts`. It adds:

- the matrix stage, which runs the changed tests against mutants (`apps/server/src/review/pipeline/harness/quality-stage.ts`);
- extra weak-test detector shapes under `apps/server/src/review/pipeline/detectors/` (for example an exact check replaced by a lower bound, a test that only checks output is not empty, a test that only counts results);
- AVA's `t.assert` counted as an assertion (`apps/server/src/review/pipeline/detectors/test-source.ts`);
- a larger read limit for test files (`MAX_TEST_BYTES` in `apps/server/src/review/pipeline/detectors/test-files.ts`).

**RECODER_CALLER_SELECTION**: `1` turns on caller selection in the change model. Callers are ranked by how much they depend on the changed behavior, and that behavior is stated next to them. It does not choose models. Read by `buildChangeModel` in `apps/server/src/review/pipeline/change-model/change-model.ts`. A caller can override it with the `callerSelection` input.

## Data and caches

**RECODER_DATA_DIR**: Directory for the SQLite database, saved settings, forge tokens and caches. Default `~/.recoder/data`. Read by `serverDataDir` in `apps/server/src/util/data-dir.ts`. Do not read the settings or token files in it: they hold keys.

**RECODER_WORKDIR**: Root for repo checkouts (`<workdir>/repos/...`) and the command runner's default working directory. Default `/tmp/recoder-work`. Parsed in `apps/server/src/env.ts`. Used in `apps/server/src/sandbox/sandbox.ts` and `apps/server/src/review/session/review-checkout.ts`.

**RECODER_REPLAY_BYTES**: Total size of kept replay checkpoints. A passed review keeps its last checkpoint for replay. Past this size the oldest are dropped first. Default 512 MiB. `0` or a non-number gives the default. Read by `keepForReplay` in `apps/server/src/store.ts`.

**RECODER_BRIEF_TTL_MS**: How long the Home brief stays cached on disk before it is rewritten. Default 12 hours. Must be positive. Read in `apps/server/src/home/home-brief.ts`. New PRs and finished reviews do not trigger a rewrite.

## HTTP server

Parsed with zod in `apps/server/src/env.ts`.

**PORT**: Listen port. Default 3001.

**HOST**: Listen address. Default `0.0.0.0`.

**FRONTEND_URL**: The web app's origin. Default `http://localhost:3000`. `trustedOrigin` in `apps/server/src/routes/trusted-origin.ts` lets it call routes that sign in or hold credentials. It is also returned by `GET /`. It does not set CORS: CORS allows any origin (`apps/server/src/app.ts`).

**NODE_ENV**: `production` stops `trustedOrigin` from trusting any `http://localhost` or `http://127.0.0.1` origin. Read in `apps/server/src/routes/trusted-origin.ts`.

**GITHUB_WEBHOOK_SECRET**: Secret for the `x-hub-signature-256` HMAC on `POST /api/webhooks/github`. Unset, the signature is not checked (`apps/server/src/routes/webhooks.ts`).

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

The Claude Code CLI does not inherit `RECODER_*`, `ANTHROPIC_*`, `CLAUDE_CODE_*`, `OPENAI_*` or any token, key, secret or password variable (`claudeCodeEnv` in `apps/server/src/agents/claude-code/claude-code-process.ts`).
