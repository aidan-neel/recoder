# Review Models

A review uses two model picks: the Review model (orchestrator) and a second model for subagents and verifiers. Each pipeline run resolves both picks once, at its start, and locks them for its calls.

## Providers

`ModelProvider` in `packages/shared/src/models.ts` has four values:

- **openai-compatible**: any endpoint that serves `POST {baseUrl}/chat/completions` (vLLM, OpenRouter, DashScope). This is the default when a config has no provider. A connected vLLM server's models are this provider too, resolved from `vllm:` ids.
- **codex**: a model reached through the user's Codex CLI, signed in with its own `codex login`. Adapter: `apps/server/src/agents/codex/codex.ts`. Its ids are `codex:<model>`.
- **opencode**: a model reached through the user's OpenCode CLI. Adapter: `apps/server/src/agents/opencode/opencode.ts`.
- **claude-code**: a Claude model reached through the user's Claude Code CLI. Adapter: `apps/server/src/agents/claude-code/claude-code.ts`.

## Resolving a pick

All in `apps/server/src/models/models.ts`. Saved settings come from `getStoredSettings` in `apps/server/src/review/session/review-settings.ts`.

`resolveConfig(orchestrator)` resolves one pick to a `ModelConfig`:

1. The Review model id is `orchestratorModelId`, else `sharedModelId`, else the first saved entry's id.
2. The second model id is `specialistModelId`. Unset, the second pick follows the Review model.
3. An id starting with `vllm:` resolves through `vllmConfig` (see below). An id starting with `opencode:` resolves through `openCodeConfig`. An id starting with `claude-code:` resolves through `claudeCodeConfig`. These ids are not saved entries; the agent CLIs list them.
4. Any other id resolves to its saved entry. If no saved entry has that id, the first saved entry is used.
5. With no saved entries, the model comes from the shared environment (`RECODER_REVIEW_BASE_URL`, `RECODER_REVIEW_API_KEY`, `RECODER_REVIEW_MODEL`), with saved top-level `baseUrl` and `apiKey` winning. If that fails, it throws `ModelConfigError`.

## vLLM servers

`apps/server/src/models/vllm/` keeps each connected vLLM server's model list in step with the server. A server (address, key, last list, last error) is saved in `vllm-servers.json` in the data dir. Its models are not saved entries: their ids are `vllm:<server id>/<model id>` (`vllmModelId` in `@recoder/shared`), and `vllmTarget` resolves one to the server's base URL, key and the model id the server listed. The request goes through the same OpenAI-compatible transport as any endpoint, so every agent loop, verifier and chat reaches it the same way.

- `GET {base}/v1/models` is read by `discoverModels` (a missing `/v1` is added); `max_model_len` is the context window.
- A sync runs on connect, at boot, every 5 minutes (`VLLM_SYNC_INTERVAL_MS`), when Settings opens (`POST /api/settings/vllm/refresh`, skipped for a server tried in the last 15 s) and on the Refresh button (`force`).
- A sync merges with `mergeServed`: new models are added; a model no longer served is dropped unless the Review or Subagent pick names it, in which case it stays with `served: false`. A model that is not served makes `vllmTarget` fail, so `configForOrchestrator` throws a `ModelConfigError` and the review stops with that message instead of falling back to another model.
- A failed sync (unreachable, 401, an empty list) keeps the last good list and records `error`. A server disconnected, or given a new key, while its sync was in flight is left as it is.
- Settings lists the models from `vllmEntries()` ahead of the agents' models. A model that is not served carries `unavailable: true`.

Effort requested:

- Review pick: `orchestratorEffort`.
- Second pick: `specialistEffort` when set. Otherwise `orchestratorEffort`, but only when the second pick follows the Review model.

Effort checked (`supportedEffort`):

- Saved entries and Claude Code models that list levels: a requested effort the model does not offer becomes its default effort, else `medium` if offered, else the first offered level.
- Saved entries with no requested effort send none.
- Codex: a requested effort the model does not list becomes its default effort, else `medium`. Before the model list is read, the effort is checked against Low to Max. The CLI's `ultra` level is not offered.
- Claude Code with no requested effort uses the model's default (`high`). Models with no levels (Haiku 4.5) send none.
- OpenCode: the effort is passed through. The transport checks it against the model's variants.
- The shared-environment model (no saved entries): the requested effort is passed through unchecked.

Other entry points:

- `configForOrchestrator()` returns the Review pick. It is used by reviewers, consolidation, repair and chat.
- `configForSubagent()` returns the second pick, for subagents and verifiers.
- `configForAgent(agent)` returns the second pick when `agent` is `subagent`, else the Review pick. Follow-ups use it so a finding is discussed on the model that made it.
- `configForModel(id, effort)` resolves one model by id, whatever the picks are. A saved-entry id that does not exist throws instead of falling back. The benchmark judge uses it (`apps/server/src/eval/benchmark-scoring.ts`).
- `isReviewConfigured()` is true when both picks resolve.

## Saved model entries

`modelEntrySchema` in `apps/server/src/review/session/review-settings.ts` validates an entry. `StoredModelEntry` is an entry with its `id` set. Fields:

- `provider`: `openai-compatible` only, or left out.
- `source`: a hosted provider id (`HOSTED_PROVIDERS` in `apps/server/src/models/model-providers.ts`: `opencode-go`, `opencode`, `openrouter`).
- `id`, `label`, `model`.
- `baseUrl`, `apiKey`.
- `efforts`, `defaultEffort`, `contextWindow`.
- `runtime`: `temperature`, `maxOutputTokens`, `topP`. These override the built-in profile from `resolveRuntime` in `apps/server/src/models/runtime-profiles.ts`.

How `entryConfig` turns an entry into a config:

- An entry with `source` uses that provider's base URL and the key saved in `connections` for it. With no key saved, it throws `ModelConfigError`.
- Any other entry uses its own `baseUrl` and `apiKey`, else the shared ones. With no base URL, it throws `ModelConfigError`.

Id formats: `opencode:<provider>/<model>` and `claude-code:<model>`. The prefixes are `OPENCODE_MODEL_PREFIX` and `CLAUDE_CODE_MODEL_PREFIX`.

## Agent CLI adapters

The adapters are listed in `AGENTS` in `apps/server/src/agents/registry.ts`. `agentModels()` returns their models; an adapter that is missing or down adds none.

OpenCode (`apps/server/src/agents/opencode/`):

- `OpenCodeServer` in `apps/server/src/agents/opencode/opencode-server.ts` starts one `opencode serve` on `127.0.0.1`, with an OS-assigned port and a random password. Later calls share it.
- Models are listed live from the CLI.
- `opencode.complete()` runs a plain call. Pipeline agents on OpenCode run through `apps/server/src/review/pipeline/agent-loop/opencode-engine.ts`, which takes limiter slots and records token calls itself.

Claude Code (`apps/server/src/agents/claude-code/`):

- `claudeCode.complete()` spawns one `claude -p` process per call. The flags turn off tools, slash commands, MCP servers, the user's customizations (`--safe-mode`) and settings files (`--setting-sources ""`), and allow three turns (`BASE_ARGS` in `apps/server/src/agents/claude-code/claude-code.ts`).
- A call that belongs to a `ChatConversation` resumes the conversation's last session as a fork and sends only the turns added since (`sessionCall` in `apps/server/src/agents/claude-code/claude-code-session.ts`). Any other call saves no session.
- The model list is static (`claudeCodeModels` in `apps/server/src/agents/claude-code/claude-code-models.ts`). Context windows are 1M, except 200K for Haiku 4.5.
- The child process does not inherit `RECODER_*`, `ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*` other than `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`, the prompt-caching, thinking and compaction switches, or any token, key, secret or password variable (`claudeCodeEnv`).

Codex (`apps/server/src/agents/codex/`), checked against codex-cli 0.167.0:

- `codex.complete()` spawns one `codex exec --ephemeral --json` per call, in an empty directory, with the system prompt in a scratch file (`model_instructions_file`) and the turns on standard input. It saves no session.
- A pipeline agent's run (`CodexRun` in `codex-run.ts`) starts one session with `codex exec` and resumes it with `codex exec resume <id>` for each later prompt. Closing the run deletes the session with `codex delete --force` and removes its scratch directory.
- `callArgs` in `codex-process.ts` builds the flags: `--ignore-user-config`, `--ignore-rules` and `--strict-config`; `--disable` for the shell, exec, image, subagent, apps, plugins, hooks, memories, browser and computer-use features; and `-c` overrides for the read-only sandbox, `approval_policy="never"`, web search off, no project docs and no saved history. Recoder's MCP server is the only server it gets. The CLI's `apply_patch` and `update_plan` tools cannot be turned off; the read-only sandbox and the empty directory contain them.
- Events are JSON lines (`thread.started`, `turn.*`, `item.*`, `error`), parsed with zod in `codex-output.ts`. An answer and a reasoning summary arrive whole, when the item completes, not as deltas. `turn.completed` reports the session's running usage, so each prompt's usage is the difference from the one before.
- Models are listed with `codex debug models`: the `list` entries, with their context windows and the efforts Recoder names.
- A usage cap becomes `UsageLimitError` with the CLI's reset time in the message. A 401 asks the user to run `codex login`. Recoder never reads or moves the CLI's sign-in.
- The child process does not inherit `RECODER_*`, `OPENAI_*`, `ANTHROPIC_*`, `CODEX_*` other than `CODEX_HOME`, or any token, key, secret or password variable (`codexEnv`).
- `RECODER_CODEX_BIN` pins the binary, and `RECODER_CODEX_CONCURRENCY` (default 4) caps its processes.

Before a review starts, `assertAgentsSignedIn` checks that every agent CLI the two picks use is signed in (`signedOutAgent` in `apps/server/src/models/agent-sign-in.ts`).

Settings saved before the Codex CLI adapter held `provider: 'codex'` entries for Recoder's own ChatGPT sign-in. Reading the settings drops those entries and moves every pick that named one to `codex:<model>` (`movedPicks` in `apps/server/src/review/session/chatgpt-migration.ts`); the server's start saves the file again and deletes the old tokens (`chatgpt-auth.json`, `codex/auth.json`) from the data dir.

Prompt caching on Claude Code, measured with CLI 2.1.295 on a subscription (1-hour cache):

- A resumed fork reads the whole earlier transcript from cache.
- A separate session reads another session's cache only up to the end of an identical system prompt. A shared start of the user message is not reused, because the CLI sets its cache breakpoints at the end of the system prompt and of the last message.
- `DISABLE_PROMPT_CACHING`, set in the environment or in a settings file's `env`, turns caching off for every call. That is why both are kept from the CLI.

## Transports

`transportFor` in `apps/server/src/models/llm/transports.ts` maps a provider to one attempt at a call:

- openai-compatible: `streamChat` or `requestChat`. A non-streaming call that wants reasoning text still streams.
- codex: `codex.complete()` from `apps/server/src/agents/codex/codex.ts`.
- opencode: `opencode.complete()`.
- claude-code: `claudeCode.complete()`.

An agent Recoder runs turn by turn resends its whole transcript on transports that keep no session. Past `maxTranscriptChars` (`REVIEW_POLICY`), `compactTranscript` in `apps/server/src/review/pipeline/agent-loop/compaction.ts` stubs its oldest tool results, keeping the brief and the latest two.

`runChat` in `apps/server/src/models/llm/run.ts` wraps the transport. It takes a limiter slot, records token usage, retries transient failures (`withRetries` in `apps/server/src/models/llm/retry.ts`) and settles by a hard deadline.

`ChatOptions` (`apps/server/src/models/llm/types.ts`) carries the provider, base URL, key, model, `messages` (system, user and assistant roles), reasoning effort, `thinking`, sampling fields, `jsonMode` or `jsonSchema`, timeouts and callbacks.

## Locked picks

`withLockedModels` in `apps/server/src/models/models.ts` wraps `runReviewPipeline` in `apps/server/src/commands/pipeline.ts`.

- It resolves both picks synchronously, before the run awaits anything.
- `runLocked` in `apps/server/src/models/llm/locked-models.ts` holds them in async context for the run. `lockedModels()` reads them.
- The configs stay in memory only, because they carry API keys.
- Each pipeline run locks its own picks. A rerun, replay or continue is a new pipeline run and resolves the picks again. Changing settings mid-run affects only runs started after.
- If a pick does not resolve at the start, the run goes on unlocked and fails through its own error handling.

Lock miss: inside a pipeline run with no locked picks, `configForOrchestrator()` or `configForSubagent()` resolves from live settings. `recordLockMiss` in `apps/server/src/models/metrics.ts` counts it on the run and logs a warning on the first one. Outside a pipeline run (discussion, fix) live resolution is normal and is not counted.

## Metrics

Stored in the SQLite table `review_metrics` (`reviewMetrics` in `apps/server/src/store.ts`), one JSON row per review id. A row holds:

- `id`, `startedAt`, `pipelineTracked`.
- `calls`: every tracked call.
- `runs`: one `PipelineRun` per pipeline run. Rows written before runs were recorded have none.

`PipelineRun` fields: `index`, `startedAt`, `orchestrator` and `subagent` (the locked model ids, null when the run went unlocked), `lockMisses`.

`trackTokenCall` in `apps/server/src/models/metrics.ts` opens a call record. `runChat` and the OpenCode agent engine (`apps/server/src/review/pipeline/agent-loop/opencode-relay.ts`) call it. A call is saved only when it runs under `withReviewMetrics` for an existing review.

A call record (`TokenCall` in `packages/shared/src/metrics.ts`, extended by `RunTokenCall`):

- `id` (UUID), `model`, `provider`.
- `scope`: `pipeline`, `discussion` or `fix`. Chat counts as `discussion`.
- `status`: `pending`, `completed` or `failed`.
- `usage`: `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`, `cacheWriteInputTokens`, `reasoningOutputTokens`.
- `apiKeySource`: optional. What paid for a Claude Code call, as the CLI reports it.
- `run`: index of the pipeline run that made the call. Pipeline calls only.
- `lockMiss: true`: a pipeline call made with no locked picks.

Usage rules:

- Every count is provider-reported or null. Null is never coerced to zero.
- Cached and reasoning counts are breakdowns. They are not added to the total.
- `normalizeTokenUsage` maps the raw usage. It reads `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details` and `completion_tokens_details`. A missing total becomes input plus output when both exist.
- `aggregateTokenCalls` sums each field over calls and counts in `reportedCalls` how many calls reported it.

Routes, in `apps/server/src/routes/reviews/lifecycle.ts`:

- `GET /api/reviews/:id/metrics` returns `ReviewMetrics` from `getReviewMetrics`: totals, per provider and model, and per scope.
- `GET /api/reviews/:id/metrics/stored` returns the stored row as is, with runs and per-call `run` and `lockMiss`.

## Settings API

Routes in `apps/server/src/routes/settings.ts`, mounted at `/api/settings`.

`GET /api/settings/models` returns `settingsPayload()`:

- `configured`, `baseUrl`, `model`, `apiKeyPreview`.
- `sharedModelId`, `orchestratorModelId`, `specialistModelId`.
- `models`: the agent CLIs' models from `agentModels()`.
- `orchestratorEffort`, `specialistEffort`, `subagentCap`, `tokenBudget`, `reportLowSeverity`. `tokenBudget` is the last budget picked; the cap and efforts may since have been changed by hand. `subagentCap` is one of 0, 3, 8, 12 or `'uncapped'`; a file saved with 2 or 4 (the caps before) loads as the nearest cap at least as large (`migrateSubagentCap`) and is saved again that way. See [pipeline.md](pipeline.md#token-budget).
- `configPath`: where settings are saved, with home shortened to `~`.
- `limits`: `maxFiles`, `maxDiffChars`, `maxFileChars`.

`PUT` and `PATCH /api/settings/models` take the same body:

- The body is validated with `reviewSettingsSchema`. Its fields match `ModelSettingsPatch` in `packages/shared/src/models.ts`.
- `saveReviewSettings` merges it over the saved settings, persists them and returns the new payload.
- An empty `apiKey`, top-level or in an entry, keeps the saved key. An empty `baseUrl` clears it.
- Sending `models` replaces the entry list. Then `dropDeletedRoutes` clears any of `sharedModelId`, `orchestratorModelId` and `specialistModelId` that is not an id in the new list. Agent CLI ids are not in that list, so they are cleared too, unless the same body sets the pick again.

Hosted provider keys live in `connections`, by provider id. They are not in the models payload.

- `GET /api/settings/providers` lists the providers with masked keys.
- `POST /api/settings/providers/:id/connect` checks a key, then saves it.
- `DELETE /api/settings/providers/:id` drops the key and every entry from that provider.

`maskKey` shows a key as `••••` plus its last four characters, or only `••••` for a key of four characters or fewer. Settings are saved in the data directory (`RECODER_DATA_DIR`, default `~/.recoder/data`, see `apps/server/src/util/data-dir.ts`). Do not read the saved settings file: it holds keys.

## Concurrency limits

`apps/server/src/models/llm/limiter.ts` keeps one limiter per endpoint. `llmEndpoint` builds the endpoint key: the base URL without trailing slashes and with a lowercase host, or the provider name when there is no base URL (codex, opencode, claude-code).

- Ceiling: `RECODER_LLM_CONCURRENCY` (default 64) for each endpoint. For `claude-code` it is the smaller of that and `RECODER_CLAUDE_CODE_CONCURRENCY` (default 8). Both are read by `envCount`.
- Backoff: below the ceiling sits an effective limit. A rate-limit error halves it, never below 4 (or the ceiling, if lower). It is cut at most once per 10-second cooldown.
- Recovery: after the cooldown, each successful call raises the limit by one until it reaches the ceiling.
- Rate-limit errors are HTTP 429, 529 or an "overloaded" message (`isRateLimitError` in `apps/server/src/models/llm/errors.ts`). A `UsageLimitError` does not count: it means a usage cap or a spent plan.
- Lowering the limit never revokes a held slot. New callers wait until the active count is under it. A freed slot goes to the oldest waiter.
- `acquireLlmSlot()` is called only when a call is ready to run. It waits up to the timeout its caller passes. `runChat` passes the call's own budget, capped by its settle time. A wait that times out throws `CapacityError`.
