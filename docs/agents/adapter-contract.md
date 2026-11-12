# Agent CLI adapter contract

Reader: an agent that adds or changes an agent CLI adapter (OpenCode, Claude Code, Devin, a custom command, and
the next ones: Codex, Grok, Copilot, Cursor, Antigravity, Pi). Paths are repository-relative. The source of
truth is `apps/server/src/agents/contract.ts`; this page explains it.

## What an adapter is

An adapter is one object that implements `AgentAdapter` and is listed in `AGENTS` in
`apps/server/src/agents/registry.ts`. Nothing else in the server names a CLI:

| Who reads it                          | What it calls                                  | File                                              |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Settings, status routes               | `detect`, `models` (via `agentStatuses`, `agentModels`) | `apps/server/src/agents/registry.ts`     |
| Model routing (`<id>:<model>` ids)    | `modelSettings` (via `agentForModel`)          | `apps/server/src/models/models.ts` (`agentConfig`) |
| Single model calls (chat, summaries)  | `complete` (via `agentById`)                   | `apps/server/src/models/llm/transports.ts` (`agentCli`) |
| Review agents (reviewers, verifiers)  | `openRun` (via `agentById`)                    | `apps/server/src/review/pipeline/agent-loop.ts` (`runJsonAgent`) |
| Process exit                          | `stop`                                         | the adapter registers it with `stopOnShutdown`    |

The adapter `id` is three things at once: the model provider (`ModelConfig.provider`), the prefix of its model
ids (`claude-code:opus`), and the key the registry looks it up by. `ModelProvider` in
`packages/shared/src/models.ts` accepts any agent id, so a new adapter does not edit it.

## The interface

```ts
interface AgentAdapter {
	readonly id: string; // provider, model-id prefix, registry key
	readonly name: string; // shown in Settings and errors
	detect(refresh?: boolean): Promise<AgentStatus>; // installed, version, signed in; cached until refresh
	models(): Promise<ModelEntry[]>; // ids `<id>:<model>`, provider `<id>`; throws when the CLI is down
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings;
	complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string>; // one call, no tools
	openRun(options: AgentRunOptions): Promise<AgentRun>; // the CLI as the agent, with Recoder's tools
	stop(): void; // kill processes, delete scratch files; synchronous
}
```

`modelSettings` gets the model id without the prefix. It returns the effort the model runs at (use
`supportedEffort` from `@recoder/shared` against the model's levels) and, for a CLI that routes to hosted
providers, `source`. Return `{}` when the CLI takes no effort.

### A run

```ts
interface AgentRunOptions {
	model: string;
	reasoningEffort?: ReasoningEffort;
	system: string; // replaces the CLI's own system prompt
	tools: readonly string[]; // native tool names the run may call; [] = answer only
	runTool: ToolRunner; // the gate; reached only through the MCP host
	onEvent: (event: AgentEvent) => void;
	signal: AbortSignal; // aborting kills the process group
}

interface AgentRun {
	prompt(text: string, options: { tools: boolean; schema?: object; timeoutMs: number }): Promise<AgentReply>;
	abort(): Promise<void>; // stop the prompt in progress; it settles with a cancelled error
	close(): Promise<void>; // give back the tool slot, delete saved sessions and scratch files
}

interface AgentReply {
	structured?: unknown; // the answer as an object, when the CLI enforced `schema`
	text: string; // the answer as text; the engine parses JSON from it
	error?: LlmError; // never throw from `prompt`: return the error
	tokens?: TokenUsage; // the whole prompt's usage, for a CLI whose steps never reported it
}
```

The engine (`apps/server/src/review/pipeline/agent-loop/native-engine.ts`) opens one run per review agent, sends
prompts until the answer validates, and calls `abort` to stop a prompt on a deadline, a pause, the call budget
or a runaway model. A later prompt must continue the same conversation (resume the CLI's session, or resend the
transcript). `options.tools` is false on the final turn; a CLI that cannot drop tools per prompt keeps them
listed, and the gate refuses every call then. When `schema` is set and the CLI cannot enforce it, append
`JSON_MODE_INSTRUCTION` (`apps/server/src/models/llm/request-fields.ts`) to the prompt.

`prompt` maps failures to `LlmError` statuses so retries and messages work: 401 signed out (say which command
signs in), 429 a usage cap or rate limit, 402 spent credit, 529 overloaded, 0 anything else. A cut-off reply
says "truncated". Use `callDeadline(...).failure` (`apps/server/src/agents/cli-process.ts`) so an abort reads as
cancelled and a timeout as timed out.

### Events

```ts
type AgentEvent =
	| { type: 'step-start'; step?: string } // a model call starts
	| { type: 'text'; delta: string; partId: string }
	| { type: 'reasoning'; delta: string; partId: string }
	| { type: 'tool-call'; name: string } // sent by the MCP host, not the adapter
	| { type: 'tool-result'; name: string; isError: boolean } // sent by the MCP host
	| { type: 'usage'; usage: TokenUsage; step?: string } // a model call ended, with its usage
	| { type: 'error'; message: string } // something the run survives; logged
	| { type: 'activity' }; // any other output: keeps the stall watchdog quiet
```

Each `step-start` spends one model call of the review's budget, and each `usage` records that call's tokens, so
emit one pair per model call when the CLI reports them. `step` pairs the two when steps overlap. A CLI that only
reports a total (Devin) emits one `step-start` at the start of the prompt and one `usage` at the end. `partId`
groups the deltas of one message; a new id starts a new message on the dashboard.

## The tool boundary

The CLI is the whole agent, and Recoder's tools are its only tools:

1. The CLI runs in an empty directory (`emptyDirectory` in `cli-process.ts`, or a scratch dir), never in the
   checkout.
2. Its own shell, file, edit, search and web tools are off, by the CLI's flags or a config it is pointed at. Its
   user config, hooks, plugins, rules and MCP servers are not loaded.
3. Recoder's tools reach it over MCP from `toolHost` in `apps/server/src/agents/tools/mcp-host.ts`. A run leases
   a slot with `toolHost.lease(options.tools, options.runTool, options.onEvent)` and gets a server `name` and a
   loopback `url` with a random token. The slot lists only the permitted tools and refuses any other name before
   the gate sees it. The adapter passes the URL to the CLI and allows only that server's tools.
4. `runTool` is `ToolGate` (`apps/server/src/review/pipeline/agent-loop/tool-gate.ts`): it applies the turn
   limits and runs each call through the evidence store, where reads are permitted reads and `run` executes in
   the review sandbox.
5. The child environment drops the server's keys and tokens (`cliEnv` with a `STRIPPED` list). Recoder never
   reads the CLI's credential files and never logs its output past what a failure message quotes.

Never pass a shell string: `streamCli` (`apps/server/src/agents/cli-stream.ts`) takes an argv array, starts the
CLI in its own process group, caps stdout (`CLI_OUTPUT_CAP_BYTES`), and kills the whole group on abort, timeout,
runaway output or exit. Parse every line the CLI prints with a zod schema; a line that does not parse is an
`error` event or a failed prompt, never something to execute.

## Shared building blocks

| Need                                      | Use                                                    |
| ----------------------------------------- | ------------------------------------------------------ |
| find the binary (pin var, PATH, install)  | `findCli` in `cli-process.ts`                          |
| status, version, sign-in, `stop`          | extend `CliAgent` in `cli-process.ts`                  |
| one process per prompt                    | extend `ProcessRun` in `process-run.ts` (lease, abort, close) |
| run a process and stream its stdout       | `streamCli` and `LineSplitter` in `cli-stream.ts`      |
| per-call deadline and failure wording     | `callDeadline` in `cli-process.ts`                     |
| one prompt text from a transcript         | `promptText`, `systemText` in `cli-prompt.ts`          |
| kill everything at exit                   | `stopOnShutdown(id, () => adapter.stop())`             |

## Registering an adapter

Put the code in `apps/server/src/agents/<cli>/`. Export one instance from `<cli>/<cli>.ts` and register its
shutdown there. Then add it to the list in `apps/server/src/agents/registry.ts`, which is the one line outside the
folder:

```ts
const AGENTS: readonly AgentAdapter[] = [opencode, claudeCode, devin, customCommand, grok];
```

Its models then reach the model list (`agentModels`), Settings, the picker and model routing with no other edit.

## Tests

Tests live in `apps/server/tests/agents/<cli>/`, mirroring `src`. They never run the real CLI and never need a
login:

- Write a fake binary with `fakeBin(name, script)` (`apps/server/tests/helpers/fake-bin.ts`) and pass its
  environment to `new YourAgent(env)`. Bun ignores `process.env.PATH` changes, so the env goes to the adapter.
  A shell script is enough for canned output; a `#!/usr/bin/env bun` script can call the MCP URL it was given
  (see `apps/server/tests/helpers/fake-claude-agent.ts`). Pick the mode with an env var, log the argv and stdin
  to a file the test reads, and print recorded events.
- `apps/server/tests/setup.ts` blanks every adapter's pin variable so a real CLI never runs; add yours there.
- `apps/server/tests/helpers/native-agent.ts` has `fixtureReview` (a review agent through the shared engine,
  reading the fixture diff with `read_diff` through the gate), `abortedPrompt` (abort kills the process tree)
  and `timedOutPrompt`.

Cover, at least: the argv (own tools off, only Recoder's MCP server, no shell), the event parser (steps, usage,
text, reasoning), a resumed second prompt, sign-in failure (401), usage limit (429 or 402), malformed output,
timeout, cancellation killing the process tree, `close` deleting saved sessions, and one `fixtureReview`.

## Checklist for a new adapter

1. Confirm every flag from `<cli> --help` or the CLI's docs. Say in the pull request which you could not confirm.
2. `apps/server/src/agents/<cli>/<cli>.ts`: an `AgentAdapter` (usually `extends CliAgent`) with `id`, `name`,
   `install`, `login`, `find` (`findCli` with a `RECODER_<CLI>_BIN` pin), `childEnv`, `signIn`, `models`
   (ids `<id>:<model>`), `modelSettings`, `complete`, `openRun`, and `stopOnShutdown`.
3. `<cli>-run.ts`: the run, usually `extends ProcessRun`; the CLI's own tools off, the leased MCP server on,
   output parsed with zod into `AgentEvent`s, failures mapped to `LlmError` statuses, sessions deleted in
   `cleanUp`.
4. One line in `AGENTS` in `registry.ts`, and the pin variable blanked in `apps/server/tests/setup.ts`.
5. Tests as above; run `check`, `lint`, `test` for `@recoder/server` and `bun run deadcode`.

## Known gaps outside the adapter folder

These still name CLIs by id and treat an unknown agent id as a plain endpoint. Until they are generalized, a new
adapter's 429 is retried as a rate limit rather than reported as a usage cap, it gets the default concurrency
ceiling, and the doctor command does not check it:

- `apps/server/src/models/llm/errors.ts` (`isTransientLlmError`, `isRateLimitError`)
- `apps/server/src/models/model-failure.ts` (`isUsageLimit`, `usageLimitFor`, `modelFailure`)
- `apps/server/src/models/llm/limiter.ts` (`PROCESS_CEILINGS`)
- `apps/server/src/cli/doctor/model-checks.ts`
- `appName` in `packages/shared/src/models.ts` (the UI falls back to the entry's `agent` name)
