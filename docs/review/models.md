# Review Models

A review uses three stage model picks: the Review model (orchestrator), a second model for subagents and workers (`specialistModelId`), and a verifier model (`verifierModelId`). Unset, `specialistModelId` and `verifierModelId` each follow the Review model. Each pipeline run resolves all three picks once, at its start, and locks them for its calls.

## Providers

`ModelProvider` in `packages/shared/src/models.ts` is `'openai-compatible' | AgentCliId`. An `AgentCliId` names a registered agent CLI adapter: `AGENT_CLIS` in `packages/shared/src/agent-clis.ts` and `AGENTS` in `apps/server/src/agents/registry.ts` list them, and a server test keeps the two equal.

- **openai-compatible**: any endpoint that serves `POST {baseUrl}/chat/completions` (vLLM, OpenRouter, DashScope). This is the default when a config has no provider. A connected vLLM server's models are this provider too, resolved from `vllm:` ids.
- **codex**: a model reached through the user's Codex CLI, signed in with its own `codex login`. Adapter: `apps/server/src/agents/codex/codex.ts`. Its ids are `codex:<model>`.
- **opencode**: a model reached through the user's OpenCode CLI. Adapter: `apps/server/src/agents/opencode/opencode.ts`.
- **claude-code**: a Claude model reached through the user's Claude Code CLI. Adapter: `apps/server/src/agents/claude-code/claude-code.ts`.
- **devin**: a model reached through the user's Devin CLI. Adapter: `apps/server/src/agents/devin/devin.ts`.
- **custom-command**: a model reached through a command the user configures with `RECODER_CUSTOM_AGENT`. Adapter: `apps/server/src/agents/custom/custom-command.ts`.
- **pi**: a model reached through the user's Pi CLI. Adapter: `apps/server/src/agents/pi/pi.ts`.
- **grok**: a model reached through the user's Grok Build CLI. Adapter: `apps/server/src/agents/grok/grok.ts`.
- **cursor**: a model reached through the user's Cursor CLI (`cursor-agent`). Adapter: `apps/server/src/agents/cursor/cursor.ts`.
- **antigravity**: a model reached through the user's Antigravity CLI (`agy`). Adapter: `apps/server/src/agents/antigravity/antigravity.ts`.
- **copilot**: a model reached through the user's GitHub Copilot CLI (`copilot`). Adapter: `apps/server/src/agents/copilot/copilot.ts`. Its ids are `copilot:<model>`.

## Resolving a pick

All in `apps/server/src/models/models.ts`. Saved settings come from `getStoredSettings` in `apps/server/src/review/session/review-settings.ts`.

`resolveConfig(role)` resolves one stage pick (`orchestrator`, `subagent`, or `verifier`) to a `ModelConfig`:

1. The Review model id is `orchestratorModelId`, else `sharedModelId`, else the first saved entry's id.
2. The second model id is `specialistModelId`. Unset, the second pick follows the Review model.
3. The verifier model id is `verifierModelId`. Unset, the verifier pick follows the Review model.
4. An id starting with `vllm:` resolves through `vllmConfig` (see below). An id starting with `<agent id>:` resolves through `agentConfig`, which finds the adapter with `agentForModel` in `apps/server/src/agents/registry.ts`. These ids are not saved entries; vLLM sync and the agent CLIs list them.
5. Any other id resolves to its saved entry. If no saved entry has that id, the first saved entry is used.
6. With no saved entries, the model comes from the shared environment (`RECODER_REVIEW_BASE_URL`, `RECODER_REVIEW_API_KEY`, `RECODER_REVIEW_MODEL`), with saved top-level `baseUrl` and `apiKey` winning. If that fails, it throws `ModelConfigError`.

## vLLM servers

`apps/server/src/models/vllm/` keeps each connected vLLM server's model list in step with the server. A server (address, key, last list, last error) is saved in `vllm-servers.json` in the data dir. Its models are not saved entries: their ids are `vllm:<server id>/<model id>` (`vllmModelId` in `@recoder/shared`), and `vllmTarget` resolves one to the server's base URL, key and the model id the server listed. The request goes through the same OpenAI-compatible transport as any endpoint, so every agent loop, verifier and chat reaches it the same way.

- `GET {base}/v1/models` is read by `discoverModels` (a missing `/v1` is added); `max_model_len` is the context window.
- A sync runs on connect, at boot, every 5 minutes (`VLLM_SYNC_INTERVAL_MS`), when Settings opens (`POST /api/settings/vllm/refresh`, skipped for a server tried in the last 15 s) and on the Refresh button (`force`).
- A sync merges with `mergeServed`: new models are added; a model no longer served is dropped unless the Review, Subagent or Verifier pick names it, in which case it stays with `served: false`. A model that is not served makes `vllmTarget` fail, so `configForOrchestrator` throws a `ModelConfigError` and the review stops with that message instead of falling back to another model.
- A failed sync (unreachable, 401, an empty list) keeps the last good list and records `error`. A server disconnected, or given a new key, while its sync was in flight is left as it is.
- Settings lists the models from `vllmEntries()` ahead of the agents' models. A model that is not served carries `unavailable: true`.

Effort requested:

- Review pick: `orchestratorEffort`.
- Second pick: `specialistEffort` when set. Otherwise `orchestratorEffort`, when the second pick follows the Review model.
- Verifier pick: `verifierEffort` when set. Otherwise `orchestratorEffort`, when the verifier pick follows the Review model.

Effort checked (`supportedEffort`):

- Saved entries and Claude Code models that list levels: a requested effort the model does not offer becomes its default effort, else `medium` if offered, else the first offered level.
- Saved entries with no requested effort send none.
- Codex: a requested effort the model does not list becomes its default effort, else `medium`. Before the model list is read, the effort is checked against Low to Max. The CLI's `ultra` level is not offered.
- Claude Code with no requested effort uses the model's default (`high`). Models with no levels (Haiku 4.5) send none.
- OpenCode: the effort is passed through. The transport checks it against the model's variants.
- Pi: checked against Pi's levels (minimal through xhigh), defaulting to `medium`; Pi lowers a level the model lacks.
- Antigravity: checked against the levels the model's catalog entry lists; a model with one level takes none.
- Grok Build, Cursor and Devin have no effort setting of their own: Grok's `grok models` names no levels, Cursor names effort inside the model slug, and Devin names it in the model id. A custom command's levels come from its `describe`.
- Copilot: the requested effort is checked against the levels every model but `auto` offers (`minimal` through `max`, default `medium`); `auto` takes no `--reasoning-effort`, and with none picked the model keeps its own default.
- The shared-environment model (no saved entries): the requested effort is passed through unchecked.

Other entry points:

- `configForOrchestrator()` returns the Review pick. It is used by reviewers, consolidation, repair and chat.
- `configForSubagent()` returns the second pick, for subagents and workers.
- `configForVerifier()` returns the verifier pick, used by the verification stage (`apps/server/src/review/pipeline/harness/verification.ts`).
- `configForAgent(agent)` returns the second pick when `agent` is `subagent`, the verifier pick when `agent` is `verifier`, else the Review pick. Follow-ups use it so a finding is discussed on the model that made it.
- `configForModel(id, effort)` resolves one model by id, whatever the picks are. A saved-entry id that does not exist throws instead of falling back. The benchmark judge uses it (`apps/server/src/eval/benchmark-scoring.ts`).
- `isReviewConfigured()` is true when all three stage picks resolve.

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

Id formats: `vllm:<server>/<model>` and `<agent id>:<model>`, where `<agent id>` is a registered adapter's id (`agentForModel` in `apps/server/src/agents/registry.ts`). `isRoutedModelId` in `@recoder/shared` recognizes both.

## Agent CLI adapters

The adapters are listed in `AGENTS` in `apps/server/src/agents/registry.ts`. `agentModels()` returns their models; an adapter that is missing or down adds none. A pipeline agent on an agent CLI runs through `apps/server/src/review/pipeline/agent-loop/native-engine.ts`, which holds one limiter slot for the whole run; `step-relay.ts` records each model step as a token call.

OpenCode (`apps/server/src/agents/opencode/`):

- `OpenCodeServer` in `apps/server/src/agents/opencode/opencode-server.ts` starts one `opencode serve` on `127.0.0.1`, with an OS-assigned port and a random password. Later calls share it.
- Models are listed live from the CLI.
- `opencode.complete()` runs a plain call through that server. Sign-in and provider keys go through its HTTP API; Recoder never reads OpenCode's credential file.
- `RECODER_OPENCODE_BIN` pins the binary. With no process per call it shares the endpoint ceiling.

Claude Code (`apps/server/src/agents/claude-code/`):

- `claudeCode.complete()` spawns one `claude -p` process per call. The flags turn off tools, slash commands, MCP servers, the user's customizations (`--safe-mode`) and settings files (`--setting-sources ""`), and allow three turns (`BASE_ARGS` in `apps/server/src/agents/claude-code/claude-code.ts`).
- A call that belongs to a `ChatConversation` resumes the conversation's last session as a fork and sends only the turns added since (`sessionCall` in `apps/server/src/agents/claude-code/claude-code-session.ts`). Any other call saves no session.
- The model list is static (`claudeCodeModels` in `apps/server/src/agents/claude-code/claude-code-models.ts`). Context windows are 1M, except 200K for Haiku 4.5.
- The child process does not inherit `RECODER_*`, `ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*` other than `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`, the prompt-caching, thinking and compaction switches, or any token, key, secret or password variable (`claudeCodeEnv`).
- The CLI signs in with the user's own subscription; Recoder never reads its credential files and never calls the Anthropic API with its token.
- `RECODER_CLAUDE_BIN` pins the binary, and `RECODER_CLAUDE_CODE_CONCURRENCY` (default 8) caps its processes.

Devin (`apps/server/src/agents/devin/`):

- `devin.complete()` spawns one `devin -p` process per call (`DEVIN_PRINT_ARGS` in `devin-run.ts`), in an empty directory, with the system prompt and turns in a prompt file. The CLI prints the answer on stdout; usage and the session id come from the `--export` file, and the session the call saved is deleted with `devin rm`.
- A run (`DevinRun`) starts one `devin -p` per prompt; later prompts resume the session with `--resume`. Its generated config (`runConfig` in `devin-process.ts`) carries only the config version and the org id, turns every `read_config_from` source off (Cursor, Windsurf, Claude, OpenCode, Zed, Copilot, the standard agents file and cloud), denies the CLI's own tools and allows only Recoder's leased MCP server. A call gets a tool-free config that denies every tool, MCP included.
- The CLI signs in itself (`devin auth login`); Recoder never reads its credential file.
- `RECODER_DEVIN_BIN` pins the binary, and `RECODER_DEVIN_CONCURRENCY` (default 4) caps its processes.

Custom command (`apps/server/src/agents/custom/`):

- The adapter runs the command `RECODER_CUSTOM_AGENT` names: a JSON `{"argv": [...], "name"?, "maxOutputBytes"?}` read by `readCustomCommand` in `custom-config.ts`, never through a shell.
- It speaks the versioned `recoder.agent` protocol (`custom-protocol.ts`, documented in `docs/agents/custom-command.md`): one JSON request on stdin, JSON events on stdout. `describe` lists its models as `custom-command:<model>`. A call is one turn; a run is one process per prompt carrying the transcript and the `session` the last result returned, with Recoder's tools over the leased MCP URL in the request.
- The command manages its own sign-in; Recoder runs it in an empty directory without the server's secrets in its environment.
- It has no binary pin and no process ceiling of its own (`processCeiling` is null): a command may front a server that takes many calls, so it shares the endpoint ceiling.

Codex (`apps/server/src/agents/codex/`), checked against codex-cli 0.167.0:

- `codex.complete()` spawns one `codex exec --ephemeral --json` per call, in an empty directory, with the system prompt in a scratch file (`model_instructions_file`) and the turns on standard input. It saves no session.
- A pipeline agent's run (`CodexRun` in `codex-run.ts`) starts one session with `codex exec` and resumes it with `codex exec resume <id>` for each later prompt. Closing the run deletes the session with `codex delete --force` and removes its scratch directory.
- `callArgs` in `codex-process.ts` builds the flags: `--ignore-user-config`, `--ignore-rules` and `--strict-config`; `--disable` for the shell, exec, image, subagent, apps, plugins, hooks, memories, browser and computer-use features; and `-c` overrides for the read-only sandbox, `approval_policy="never"`, web search off, no project docs, no saved history, and a model catalog with no sub-agents (below). Recoder's MCP server is the only server it gets.
- Sub-agents: a model's `multi_agent_version` in the CLI's catalog gives it the sub-agent tools (`v1` a deferred `multi_agent_v1` namespace, `v2` the `collaboration` namespace with `spawn_agent`), and `--disable multi_agent` leaves them on. So the adapter reads the catalog once with `codex debug models`, writes it to a scratch file without that field (`catalogWithoutSubagents` in `codex-models.ts`), and every call names the file with `-c model_catalog_json`. A request recorded from `codex exec` under these flags offers `exec`, `wait` and `request_user_input` and no sub-agent tool. When the catalog cannot be read, no call runs.
- Known gaps, which no flag or `-c` key of codex-cli 0.167.0 turns off:
  - The user's global instructions, `$CODEX_HOME/AGENTS.md` (or `AGENTS.override.md`), go to the model as a user message on every call, under `--ignore-user-config` and `project_doc_max_bytes=0`. Recoder cannot point `CODEX_HOME` elsewhere, since the sign-in lives there, so the user's own instructions can shape a review or a reply.
  - The CLI's own `exec` (code mode), `wait` and `request_user_input` tools, which stay in the request under every `--disable` flag above. Through `exec` the model also reaches `apply_patch`. The read-only sandbox and the empty directory contain what these tools can do.
- The catalog file is read once and kept for the adapter's life (`subagentFreeCatalog` in `codex.ts`), so a catalog change waits for a restart. Its first read can hold the first call or run for up to 20 s (`MODELS_TIMEOUT_MS`), and the temp folder holding it is deleted by `stop`; an exit that skips `stop` leaves it behind.
- Events are JSON lines (`thread.started`, `turn.*`, `item.*`, `error`), parsed with zod in `codex-output.ts`. An answer and a reasoning summary arrive whole, when the item completes, not as deltas. `turn.completed` reports the session's running usage, so each prompt's usage is the difference from the one before.
- Models are listed with `codex debug models`: the `list` entries, with their context windows and the efforts Recoder names.
- A usage cap becomes `UsageLimitError` with the CLI's reset time in the message. A 401 asks the user to run `codex login`. Recoder never reads or moves the CLI's sign-in.
- The child process does not inherit `RECODER_*`, `OPENAI_*`, `ANTHROPIC_*`, `CODEX_*` other than `CODEX_HOME`, or any token, key, secret or password variable (`codexEnv`).
- `RECODER_CODEX_BIN` pins the binary, and `RECODER_CODEX_CONCURRENCY` (default 4) caps its processes.

Pi (`apps/server/src/agents/pi/`):

- `pi.complete()` spawns one `pi -p --mode text` process per call (`printArgs` in `pi-process.ts`). The system prompt goes in a file, the turns on stdin, and the answer streams on stdout. `SessionTail` (`pi-session.ts`) reads each model call's thinking, text and usage from the call's JSONL session file.
- A run (`PiRun`) starts one `pi -p` per prompt, each continuing the run's session file, in an empty `work` directory inside the scratch dir. Every call and run gets a private scratch dir — system prompt and session file — deleted afterwards.
- `PI_ISOLATION_ARGS` in `pi-process.ts` turn off extensions, skills, prompt templates, themes and context files, and an empty `--append-system-prompt` blocks the user's `APPEND_SYSTEM.md`; `--offline` and `PI_OFFLINE=1` keep startup steps off the network. A call runs `--no-tools`; a run with tools gets a generated extension (`pi-tool-bridge.ts`) that forwards each call to the run's leased MCP server, since Pi has no MCP client.
- The environment drops `RECODER_*`, `PI_*` other than `PI_CODING_AGENT_DIR`, other providers' keys, and any token, key, secret or password variable.
- Pi signs in itself (`pi`, then `/login`); Recoder never reads its agent dir. `PI_CODING_AGENT_DIR` stays in the environment because it holds the sign-in.
- Models are listed with `pi --list-models` under the same isolation flags.
- `RECODER_PI_BIN` pins the binary, and `RECODER_PI_CONCURRENCY` (default 4) caps its processes.
- Known gaps: the user's `settings.json`, `models.json` and `auth.json` (its sign-in and provider keys) still load from the agent dir. A hung Pi is stopped by the prompt deadline only: its session tail reports activity while it polls, so a run's stall check never fires.

Grok Build (`apps/server/src/agents/grok/`):

- `grok.complete()` spawns one `grok` process per call in an empty home and working directory under one scratch dir, deleted after. It reads `--output-format streaming-messages-json` with partial messages (`PRINT_ARGS` in `grok-run.ts`): text and thinking stream from `stream_event` deltas, the terminal `result` line carries the answer and usage, and `system/init` reports the auth source (`grok-reply.ts`, `grok-run-reader.ts`).
- A run (`GrokRun`) starts one `grok` process per prompt in one prepared home; the first prompt opens a session with `-s`, and later prompts resume it with `-r` once `init` proved the session exists. Only the `search_tool`/`use_tool` meta-tools stay on, reaching Recoder's leased MCP server named in the run's project config `.grok/config.toml`; `--no-subagents`, `--no-plan` and `--disable-web-search` keep the CLI's own features out.
- The prepared home's `config.toml` (`prepareHome` in `grok-process.ts`) keeps marketplace auto-install off and hides the bundled skills; `GROK_*_ENABLED=false` switches turn off the Claude and Cursor compat surfaces, and `GROK_MEMORY=0` turns memory off. The environment drops `RECODER_*`, `GROK_*`, other providers' keys and any token, key, secret or password variable.
- The CLI signs in itself (browser OAuth, or `XAI_API_KEY`, which is passed through). Recoder never reads, copies, links or moves the auth file: `GROK_AUTH_PATH` (`realAuthPath` in `grok-process.ts`) names the user's own file, so the CLI reads and refreshes it in place.
- `grok models` names no effort levels, so a Grok model has none to set.
- `RECODER_GROK_BIN` pins the binary, and `RECODER_GROK_CONCURRENCY` (default 4) caps its processes.
- Known gaps: the error wordings and the `-r` resume flag were not confirmed against a failing real CLI.

Cursor (`apps/server/src/agents/cursor/`):

- `cursor.complete()` spawns one `cursor-agent -p` process per call (`PRINT_ARGS` in `cursor-print.ts`), with `--output-format stream-json` and partial output. It reads `init`, `assistant`, `thinking`, `step_finish` and `result` events (`cursor-output.ts`); the `result` event ends the call and the process group is killed after a 250 ms grace.
- A run (`CursorRun`) starts one `cursor-agent -p` per prompt; the first carries the system prompt on stdin (the CLI has no system-prompt flag), and later prompts resume the saved chat with `--resume`.
- Each call or run gets an isolated `CURSOR_CONFIG_DIR`, `CURSOR_DATA_DIR` and an empty `work` directory under one scratch root (`cursorPlace` in `cursor-process.ts`). The generated `cli-config.json` uses `allowlist` permissions, denies the CLI's shell, read, write and web tools, and allows only Recoder's leased MCP server; `sandbox.readBoundary` bounds its reads and searches to the workspace on Cursor 3.23+. A leased run also gets an `mcp.json` naming the server.
- The environment drops `RECODER_*`, `CURSOR_*` other than `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`, other providers' keys and any token, key, secret or password variable; it keeps PATH, HOME, locale, temp and XDG dirs and proxies.
- The CLI signs in itself. Recoder never reads, copies or links its credential file. `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN` are the documented headless sign-in and reach every call; where `cursor-agent login` keeps its sign-in is not confirmed.
- `RECODER_CURSOR_BIN` pins the binary, and `RECODER_CURSOR_CONCURRENCY` (default 4) caps its processes.
- Known gaps: the adapter was written without the real CLI installed. Not confirmed: where a `cursor-agent login` sign-in is kept, the read boundary before Cursor 3.23, the precedence of `sandbox.json`, the shape of `result.usage`, the place of `mcp.json`, and the `HOME` passthrough.

Antigravity (`apps/server/src/agents/antigravity/`):

- `agy` runs as one headless process per call or prompt (`ANTIGRAVITY_STREAM_ARGS` in `antigravity-process.ts`): `--input-format stream-json --output-format stream-json` with prompts as NDJSON user events on stdin. Recoder reads `init`, `step_update` and `result` events for text, thinking, conversation ids, errors and usage (`antigravity-output.ts`).
- A run (`AntigravityRun`) starts one `agy` process per prompt; later prompts resume the conversation with `--conversation <id>`. Each call or run gets a session-only `--settings` file and a generated `recoder` agent definition in an empty workspace: built-in shell, file, network and URL actions are denied, and user customizations, skills, rules, plugins, subagents, MCP servers and hooks are excluded. Only Recoder's leased MCP server and its permitted tools are attached.
- The environment drops `RECODER_*`, `AGY_*`, `ANTIGRAVITY_*`, Gemini and provider overrides, and any token, key, secret or password variable; it keeps HOME.
- The CLI signs in itself (`agy acp --login`); Recoder never reads its credential files.
- `RECODER_ANTIGRAVITY_BIN` pins the binary, and `RECODER_ANTIGRAVITY_CONCURRENCY` (default 4) caps its processes.
- Known gaps:
  - `agy` 1.5.6 has no flag to skip saving a conversation and no delete command, so Recoder deletes each conversation's files and its entries in the two summary stores (`conversation_summaries.db` and `jetbox_summaries_proto.pb`) itself (`antigravity-conversations.ts`, `antigravity-summaries.ts`).
  - A running `agy` writes back the summaries it loaded at its start, so a conversation deleted while another `agy` runs is deleted again when the adapter's last `agy` process ends. The user's own `agy` session is outside this: it can write back a conversation that existed when it started.
  - `manage_task` and `invoke_subagent` stay listed, and the global `~/.gemini/config/hooks.json` and the user's memory cannot be turned off.
  - The signed-out stderr wording and the 429 shapes were not confirmed live.

GitHub Copilot (`apps/server/src/agents/copilot/`), checked against copilot-cli 1.0.109:

- `copilot.complete()` spawns one `copilot` process per call in an empty directory under its own scratch `COPILOT_HOME`. The system prompt and turns go in on stdin, since a review's diff can pass the kernel's per-argument limit. Text and reasoning stream from `assistant.message_delta` and `assistant.reasoning_delta`; the authoritative `assistant.message` and `assistant.reasoning` events add only what has not streamed, and the reply is the last message part's text — a tool turn's earlier messages are narration (`copilot-output.ts`).
- A run (`CopilotRun`) starts one `copilot` process per prompt; every prompt carries the same `--session-id`, so later prompts continue the same conversation. A prompt with tools off gets `--available-tools recoder-no-tools`, a name nothing has, so the model sees no tool at all; with tools on it gets Recoder's leased MCP server through `--additional-mcp-config`, `--available-tools <lease>` and `--allow-tool <lease>` (`toolArgs` in `copilot-run.ts`).
- `PROMPT_ARGS` close what prompt mode cannot need: `--no-ask-user`, `--disallow-temp-dir`, `--disable-builtin-mcps`, `--no-custom-instructions`, `--sync-session=off`, the built-in tools named in `--excluded-tools` with their kinds denied by `--deny-tool` (a deny rule wins over every allow), and `--secret-env-vars` naming only `COPILOT_GITHUB_TOKEN`.
- The empty scratch `COPILOT_HOME` keeps the user's settings, hooks, plugins, skills, custom instructions, MCP servers and sessions out of every call and run; the working directory is an empty one nothing trusts, which skips workspace MCP servers, repository hooks and project extensions. A call's scratch dir is deleted when it ends; a run's on `close`, and `stop` deletes whatever a run never closed (`scratchDir` and `removeScratchDir` in `cli-process.ts`).
- The environment drops `RECODER_*`, `COPILOT_*`, `GITHUB_COPILOT_*`, other providers' keys and any token, key, secret or password variable; it keeps PATH, HOME, locale, temp and XDG dirs and proxies. `GH_TOKEN` and `GITHUB_TOKEN` are the server's forge credentials and never cross; `COPILOT_GITHUB_TOKEN` is the one forwarded (`copilotEnv` in `copilot-process.ts`).
- Sign-in: under the empty home and no token the CLI falls back to `gh auth token`, so `gh auth login` is the sign-in a run sees and `COPILOT_GITHUB_TOKEN` the headless one. `copilot login` saves the account under `COPILOT_HOME`, which every run replaces with an empty scratch dir, so that sign-in is invisible to the next call. The CLI has no status command, so `detect` leaves sign-in unknown and a signed-out call surfaces as the 401 naming `gh auth login`. Recoder never reads the CLI's credential files.
- Models are a fixed list (`copilotModels` in `copilot-models.ts`): the ids `copilot help config` documents plus `auto`, which lets the CLI pick. The CLI has no command that lists models, so a plan-gated id fails loudly at call time. Every model but `auto` is offered the levels `--reasoning-effort` takes (`minimal` through `max`, the picker's default `medium`); which levels a given model honors is per-model and not confirmed.
- Usage: `--usage-output-file` writes the session's cumulative totals per model when it ends; a run differences them against what earlier prompts counted (`usageDelta` in `apps/server/src/agents/usage-delta.ts`, shared with Devin), and a call reads the file once.
- Failures map in `copilotFailure`: signed-out wording is a 401 naming `gh auth login` or `COPILOT_GITHUB_TOKEN`, Copilot's premium-request and quota wording a `UsageLimitError`, a bare throttle or 429 a retryable `LlmError`, and anything else the message the CLI gave, quoted through `quotedLine` first.
- `RECODER_COPILOT_BIN` pins the binary (a `copilot` that is VS Code's launcher shim is not the CLI and is skipped), and `RECODER_COPILOT_CONCURRENCY` (default 4) caps its processes.
- Known gaps: the usage-cap wording is not confirmed against a real account; which model ids a plan offers is not confirmed; which effort levels each model honors is not confirmed.

Before a review starts, `assertAgentsSignedIn` in `apps/server/src/commands/pipeline.ts` checks that every agent CLI the three stage picks use is signed in: `signedOutAgent` in `apps/server/src/models/agent-sign-in.ts` over `stageConfigs()` in `apps/server/src/models/models.ts`.

Settings saved before the Codex CLI adapter held `provider: 'codex'` entries for Recoder's own ChatGPT sign-in. Reading the settings drops those entries and moves every pick that named one to `codex:<model>` (`movedPicks` in `apps/server/src/review/session/chatgpt-migration.ts`); the server's start saves the file again and deletes the old tokens (`chatgpt-auth.json`, `codex/auth.json`) from the data dir.

Prompt caching on Claude Code, measured with CLI 2.1.295 on a subscription (1-hour cache):

- A resumed fork reads the whole earlier transcript from cache.
- A separate session reads another session's cache only up to the end of an identical system prompt. A shared start of the user message is not reused, because the CLI sets its cache breakpoints at the end of the system prompt and of the last message.
- `DISABLE_PROMPT_CACHING`, set in the environment or in a settings file's `env`, turns caching off for every call. That is why both are kept from the CLI.

## Transports

`transportFor` in `apps/server/src/models/llm/transports.ts` maps a provider to one attempt at a call:

- openai-compatible: `streamChat` or `requestChat`. A non-streaming call that wants reasoning text still streams.
- every agent CLI: the `agentCli` transport finds the adapter with `agentById` in `apps/server/src/agents/registry.ts` and runs `agent.complete()`. `TRANSPORTS` names only openai-compatible; every other provider is an agent CLI.

An agent Recoder runs turn by turn resends its whole transcript on transports that keep no session. Past `maxTranscriptChars` (`REVIEW_POLICY`), `compactTranscript` in `apps/server/src/review/pipeline/agent-loop/compaction.ts` stubs its oldest tool results, keeping the brief and the latest two.

`runChat` in `apps/server/src/models/llm/run.ts` wraps the transport. It takes a limiter slot, records token usage, retries transient failures (`withRetries` in `apps/server/src/models/llm/retry.ts`) and settles by a hard deadline.

`ChatOptions` (`apps/server/src/models/llm/types.ts`) carries the provider, base URL, key, model, `messages` (system, user and assistant roles), reasoning effort, `thinking`, sampling fields, `jsonMode` or `jsonSchema`, timeouts and callbacks.

## Locked picks

`withLockedModels` in `apps/server/src/models/models.ts` wraps `runReviewPipeline` in `apps/server/src/commands/pipeline.ts`.

- It resolves all three picks synchronously, before the run awaits anything.
- `runLocked` in `apps/server/src/models/llm/locked-models.ts` holds them in async context for the run. `lockedModels()` reads them.
- The configs stay in memory only, because they carry API keys.
- Each pipeline run locks its own picks. A rerun, replay or continue is a new pipeline run and resolves the picks again. Changing settings mid-run affects only runs started after.
- If a pick does not resolve at the start, the run goes on unlocked and fails through its own error handling.

Lock miss: inside a pipeline run with no locked picks, `configForOrchestrator()`, `configForSubagent()` or `configForVerifier()` resolves from live settings. `recordLockMiss` in `apps/server/src/models/metrics.ts` counts it on the run and logs a warning on the first one. Outside a pipeline run (discussion, fix) live resolution is normal and is not counted.

## Metrics

Stored in the SQLite table `review_metrics` (`reviewMetrics` in `apps/server/src/store.ts`), one JSON row per review id. A row holds:

- `id`, `startedAt`, `pipelineTracked`.
- `calls`: every tracked call.
- `runs`: one `PipelineRun` per pipeline run. Rows written before runs were recorded have none.

`PipelineRun` fields: `index`, `startedAt`, `orchestrator`, `subagent` and `verifier` (the locked model ids, null when the run went unlocked), `lockMisses`, `tokenBudget`, and `history`: which repository history the run received (`RunHistory`: `sources`, the brief's history sources without their text; `dismissals`, the fingerprints of dismissed findings; `topics`, the votes per topic). A part the run never read is absent; one it read and found empty is empty.

`trackTokenCall` in `apps/server/src/models/metrics.ts` opens a call record. `runChat` and `StepRelay` (`apps/server/src/review/pipeline/agent-loop/step-relay.ts`, which every agent CLI's pipeline run uses through `native-engine.ts`) call it. A call is saved only when it runs under `withReviewMetrics` for an existing review. Its `complete()` or `fail(err, secrets)` closes it. An agent prompt that fails before its first step starts (a spent plan, a rejected key) is still saved as one failed call.

A call record (`TokenCall` in `packages/shared/src/metrics.ts`, extended by `RunTokenCall`):

- `id` (UUID), `model`, `provider`.
- `scope`: `pipeline`, `discussion` or `fix`. Chat counts as `discussion`.
- `status`: `pending`, `completed` or `failed`.
- `error`: a failed call's provider error, its last lines with the call's key, key and token shapes, authorization headers and home paths removed (`providerErrorText` in `apps/server/src/models/error-text.ts`).
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
- `sharedModelId`, `orchestratorModelId`, `specialistModelId`, `verifierModelId`.
- `models`: the connected vLLM servers' models and the agent CLIs' models.
- `orchestratorEffort`, `specialistEffort`, `verifierEffort`, `subagentCap`, `tokenBudget`, `reportLowSeverity`. `tokenBudget` is the last budget picked; the cap and efforts may since have been changed by hand. `subagentCap` is one of 0, 3, 8, 12 or `'uncapped'`; a file saved with 2 or 4 (the caps before) loads as the nearest cap at least as large (`migrateSubagentCap`) and is saved again that way. See [pipeline.md](pipeline.md#token-budget).
- `configPath`: where settings are saved, with home shortened to `~`.
- `limits`: `maxFiles`, `maxDiffChars`, `maxFileChars`.

`PUT` and `PATCH /api/settings/models` take the same body:

- The body is validated with `reviewSettingsSchema`. Its fields match `ModelSettingsPatch` in `packages/shared/src/models.ts`.
- `saveReviewSettings` merges it over the saved settings, persists them and returns the new payload.
- An empty `apiKey`, top-level or in an entry, keeps the saved key. An empty `baseUrl` clears it.
- Sending `models` replaces the stored HTTP entry list. `dropDeletedRoutes` clears any of `sharedModelId`, `orchestratorModelId`, `specialistModelId` and `verifierModelId` whose stored HTTP route was deleted, while keeping routed picks (`vllm:` and `<agent id>:` ids, which `isRoutedModelId` in `@recoder/shared` recognizes), which live outside the stored HTTP entry list.

Hosted provider keys live in `connections`, by provider id. They are not in the models payload.

- `GET /api/settings/providers` lists the providers with masked keys.
- `POST /api/settings/providers/:id/connect` checks a key, then saves it.
- `DELETE /api/settings/providers/:id` drops the key and every entry from that provider.

`maskKey` shows a key as `••••` plus its last four characters, or only `••••` for a key of four characters or fewer. Settings are saved in the data directory (`RECODER_DATA_DIR`, default `~/.recoder/data`, see `apps/server/src/util/data-dir.ts`). Do not read the saved settings file: it holds keys.

## Concurrency limits

`apps/server/src/models/llm/limiter.ts` keeps one limiter per endpoint. `llmEndpoint` builds the endpoint key: the base URL without trailing slashes and with a lowercase host, or the provider name when there is no base URL. Every agent CLI's config has an empty base URL, so its endpoint is its provider id.

- Ceiling: `RECODER_LLM_CONCURRENCY` (default 64) for each endpoint. An agent CLI that starts a process per call has a lower one: the smaller of the two, from the adapter's `processCeiling`. That is `RECODER_CLAUDE_CODE_CONCURRENCY` (default 8) for `claude-code`, and `RECODER_CODEX_CONCURRENCY`, `RECODER_DEVIN_CONCURRENCY`, `RECODER_PI_CONCURRENCY`, `RECODER_GROK_CONCURRENCY`, `RECODER_CURSOR_CONCURRENCY`, `RECODER_ANTIGRAVITY_CONCURRENCY` or `RECODER_COPILOT_CONCURRENCY` (each default 4). `opencode` and `custom-command` start no process per call and share the endpoint ceiling. `envCount` reads them all.
- Backoff: below the ceiling sits an effective limit. A rate-limit error halves it, never below 4 (or the ceiling, if lower). It is cut at most once per 10-second cooldown.
- Recovery: after the cooldown, each successful call raises the limit by one until it reaches the ceiling.
- Rate-limit errors are HTTP 429, 529 or an "overloaded" message (`isRateLimitError` in `apps/server/src/models/llm/errors.ts`). A `UsageLimitError` does not count: it means a usage cap or a spent plan.
- Lowering the limit never revokes a held slot. New callers wait until the active count is under it.
- Fair turns: each review's calls wait in their own lane (`withLlmLane`, opened by `withReviewMetrics`). A freed slot goes to the next lane in round-robin order and to that lane's oldest waiter, so one large review cannot hold back another. Calls made outside a review share one lane.
- `acquireLlmSlot()` is called only when a call is ready to run. It waits up to the timeout its caller passes. `runChat` passes the call's own budget, capped by its settle time. A wait that times out throws `CapacityError` (`apps/server/src/models/llm/errors.ts`), a failure kind of its own: the model never saw the call.
- Queue delay: each pipeline run records how long its calls waited for a slot (`queueDelay` on the run and on `GET /api/reviews/:id/metrics`: requests, total and longest wait in milliseconds).
- Load sweep: `bun run --filter @recoder/server eval:load` runs fake reviews against a fake model server through this limiter at several concurrency levels. It prints throughput, queue delay, review duration and capacity failures per level, and the range where more concurrency still helps. It uses no model, forge or storage. Flags: `--reviews`, `--requests` (per review, sent at once), `--levels` (comma-separated), `--model-parallel`, `--latency` (ms) and `--queue-timeout` (seconds).
