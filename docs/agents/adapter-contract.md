# Agent CLI adapter contract

Reader: an agent that adds or changes an agent CLI adapter (OpenCode, Claude Code, Devin, a custom command, and
the next ones: Codex, Grok, Copilot, Cursor, Antigravity, Pi). Paths are repository-relative. The source of
truth is `apps/server/src/agents/contract.ts`; this page explains it.

## What an adapter is

An adapter is one object that implements `AgentAdapter` and is listed in `AGENTS` in
`apps/server/src/agents/registry.ts`. Every fact about one CLI lives on the adapter; the rest of the server reads
it through the registry and never names a CLI:

| Who reads it                               | What it calls                                         | File                                                       |
| ------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| Settings, status routes                    | `detect`, `models` (via `agentStatuses`, `agentModels`) | `apps/server/src/agents/registry.ts`                     |
| Model routing (`<id>:<model>` ids)         | `modelSettings` (via `agentForModel`)                 | `apps/server/src/models/models.ts` (`agentConfig`)         |
| Single model calls (chat, summaries)       | `complete` (via `agentById`)                          | `apps/server/src/models/llm/transports.ts` (`agentCli`)    |
| Review agents (reviewers, verifiers)       | `openRun` (via `agentById`)                           | `apps/server/src/review/pipeline/agent-loop.ts`            |
| Failure messages, usage limits             | `describeFailure`, and the `UsageLimitError`s it raises | `apps/server/src/models/model-failure.ts`                |
| Retries, the limiter's back-off            | the `UsageLimitError`s it raises                      | `apps/server/src/models/llm/errors.ts`                     |
| Concurrency                                | `processCeiling`                                      | `apps/server/src/models/llm/limiter.ts`                    |
| `--reviewer`, `--worker`, `recoder models` | `installed`, `fixedModels`, `models(signal)`          | `apps/server/src/cli/run/model-choices.ts`                 |
| `recoder doctor`                           | `quickStatus`, `signInFix`, `fixedModels`             | `apps/server/src/cli/doctor/model-checks.ts`               |
| Process exit                               | `stop`                                                | the adapter registers it with `stopOnShutdown`             |

The adapter `id` is three things at once: the model provider (`ModelConfig.provider`), the prefix of its model
ids (`claude-code:opus`), and the key the registry looks it up by. The apps learn the id, the name and the model id
prefix without the server from `AGENT_CLIS` in `packages/shared/src/agent-clis.ts`, the one shared table; a
server test (`apps/server/tests/agents/registry.test.ts`) fails when it and the registry differ. Code that must
know whether a model id is routed through an agent CLI uses `agentCliOfModel` or `isRoutedModelId` from there.

## The interface

```ts
interface AgentAdapter {
	readonly id: string; // provider, model-id prefix, registry key
	readonly name: string; // shown in Settings and errors
	readonly processCeiling: { env: string; fallback: number } | null; // calls at once when each starts a process
	readonly signInFix: string; // what `recoder doctor` says when the agent does not list the picked model
	detect(refresh?: boolean): Promise<AgentStatus>; // installed, version, signed in; cached until refresh
	quickStatus(): Promise<AgentStatus>; // the same, starting nothing that outlives the check (doctor)
	installed(): boolean; // binary found (or command configured), without running it
	models(signal?: AbortSignal): Promise<ModelEntry[]>; // ids `<id>:<model>`; throws when down; signal kills it
	fixedModels(): ModelEntry[] | null; // a list known without running the CLI; null when only running lists them
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings;
	complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string>; // one call, no tools
	openRun(options: AgentRunOptions): Promise<AgentRun>; // the CLI as the agent, with Recoder's tools
	describeFailure(err: LlmError, fallback: string, source: string | undefined): ModelFailure;
	stop(): void; // kill processes, delete scratch files; synchronous
}
```

An adapter that extends `CliAgent` (`apps/server/src/agents/cli-process.ts`) inherits `quickStatus` (its
`detect`), `installed` (`find() !== null`), `fixedModels` (`null`) and `describeFailure` (`cliFailure` in
`apps/server/src/agents/cli-failure.ts`); it declares `processCeiling` and `signInFix` itself.

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

`prompt` and `complete` map failures to errors from `apps/server/src/models/llm/errors.ts`, so retries, the
limiter and messages work with no code outside the adapter:

| The CLI says                                 | Raise                                   | What happens                                       |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| signed out                                   | `new LlmError(401, '<how to sign in>')` | not retried; the message is shown                   |
| a usage cap or spent plan (lasts hours)      | `new UsageLimitError(429, message)`     | not retried; shown as out of usage, with `message` |
| spent credit                                 | `new UsageLimitError(402, message)`     | the same                                           |
| a throttle that lifts within minutes         | `new LlmError(429, message)`            | retried with back-off; the limiter eases off       |
| overloaded                                   | `new LlmError(529, message)`            | retried; the limiter eases off                     |
| a reply cut at its output limit              | `new LlmError(0, '… truncated …')`      | not retried                                        |
| anything else                                | `new LlmError(0, message)`              | retried only when it reads as a dropped connection |

Use `callDeadline(...).failure` (`apps/server/src/agents/cli-process.ts`) so an abort reads as cancelled and a
timeout as timed out. Quote the CLI's own output in a message only through `quotedLine`
(`apps/server/src/agents/quoted-line.ts`), which redacts credentials first.

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
   loopback `url` with a random token, new for every lease, so a released run's URL never reaches the next run.
   The slot lists only the permitted tools and refuses any other name before the gate sees it. The adapter passes the URL to the CLI and allows only that server's tools.
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
| quote CLI output in an error or event     | `quotedLine` in `quoted-line.ts` (redacts credentials) |
| word a failure for the developer          | `cliFailure` in `cli-failure.ts` (`CliAgent` uses it)  |

## Adding an adapter: the checklist

Follow these steps in order. `<cli>` is the folder name and `<id>` the adapter id (lowercase, `-` between words,
for example `codex-cli`); `<Cli>` is the class prefix (`CodexCli`). Copy the shape of `apps/server/src/agents/devin/`
(a CLI with one process per prompt) or `apps/server/src/agents/claude-code/` (one with stream-json events).

### 1. Confirm the CLI

1. Read `<cli> --help` and the CLI's docs. Confirm every flag you will pass: print mode, the model flag, how to
   turn off its own tools, how to give it one MCP server over HTTP, how to resume a session, how to delete a saved
   session, how to stop it loading user config, hooks, plugins, rules and other tools' config. Write down any flag
   you could not confirm; say so in the pull request.
2. Find what it prints when signed out, when a usage cap is hit, and when a rate limit is hit.

### 2. Create the folder `apps/server/src/agents/<cli>/`

3. `<cli>.ts`: `export class <Cli>Agent extends CliAgent` with
   - `readonly id = '<id>'`, `readonly name = '<Name>'`, `readonly install` (the install command), `readonly login`
     (the sign-in command);
   - `readonly processCeiling = { env: 'RECODER_<ID>_CONCURRENCY', fallback: 4 }` (one process per call), or `null`
     with a docstring saying why;
   - `readonly signInFix`, for example ``Sign in with `<cli> auth login`, or pick another model in Recoder settings.``;
   - `protected find()`: `findCli({ pin: 'RECODER_<ID>_BIN', command: '<cli>', installed: [...] }, this.env)`;
   - `protected childEnv()`: `cliEnv(this.env, STRIPPED)`, where `STRIPPED` drops `RECODER_*`, the CLI's own
     override variables, and every `*_TOKEN`, `*_API_KEY`, `SECRET` and `PASSWORD`;
   - `protected signIn(path)`: runs the CLI's status command and returns `{ signedIn }`;
   - `models(signal?)`: ids `` `<id>:<model>` ``, `provider: '<id>'`; kill the process when `signal` aborts;
     throw an `LlmError` when the CLI is missing or lists nothing;
   - `fixedModels()`: override only when the CLI has no command that lists models (return the fixed list);
   - `modelSettings(model, requested)`: `supportedEffort` from `@recoder/shared` against the model's levels, or `{}`;
   - `complete(opts, onToken)`: one call, all tools off, in `emptyDirectory('<cli>-empty')`, through `streamCli`;
   - `openRun(options)`: `return <Cli>Run.open(host, options)`;
   - at the end of the file: `export const <camelId> = new <Cli>Agent();` and
     `stopOnShutdown('<id>', () => <camelId>.stop());`.
4. `<cli>-run.ts`: `export class <Cli>Run extends ProcessRun`. Its constructor calls `super(options)`, which leases
   the tool slot (`this.lease`: `name` and `url`). `prompt(text, options)` calls `this.begin(options.timeoutMs)`,
   runs the CLI with `streamCli` (argv array, `signal: deadline.signal`, `maxOutputBytes: CLI_OUTPUT_CAP_BYTES`,
   `running: host.running`), passes the leased MCP server and allows only `mcp__<lease.name>` tools, turns every
   built-in tool off, emits `AgentEvent`s, and never throws: it returns `{ text, error }`. `cleanUp()` deletes the
   run's scratch dir and awaits the deletion of every session the CLI saved for this run, and no other run's.
5. `<cli>-output.ts` (or `<cli>-reply.ts`): zod schemas for every line the CLI prints, the event parser, and the
   failure mapping in the table above. Quote CLI output only through `quotedLine`.
6. `<cli>-process.ts` when the CLI needs a config file: build it from the fields a run needs and nothing else (no
   hooks, no MCP servers, no imports of other tools' config), write it under the run's scratch dir, and point the
   CLI at it (a flag, or `XDG_CONFIG_HOME`). Never read or copy the CLI's credential file.

### 3. Register it

7. `apps/server/src/agents/registry.ts`: add the instance to `AGENTS`. This is the only line outside the folder in
   `apps/server/src`:

   ```ts
   const AGENTS: readonly AgentAdapter[] = [opencode, claudeCode, devin, customCommand, codexCli];
   ```

8. `packages/shared/src/agent-clis.ts`: add one entry to `AGENT_CLIS`, with the same `id` and `name` as the adapter:

   ```ts
   { id: 'codex-cli', name: 'Codex CLI', groupsModelsUnderName: true }
   ```

   `groupsModelsUnderName` is `true` unless the pickers should group its models under another name.

9. `apps/server/tests/helpers/agent-bins.ts`: add `RECODER_<ID>_BIN` to `AGENT_BIN_PINS`, the one list of binary
   pins. `apps/server/tests/setup.ts` and `apps/server/tests/cli/child-env.ts` blank every pin on it, so no test —
   or process a test starts — runs the real CLI.

### 4. Write the fake and the tests

10. `apps/server/tests/helpers/fake-<cli>.ts`: a fake binary made with `fakeBin('<cli>', SCRIPT)`
    (`apps/server/tests/helpers/fake-bin.ts`), with the docstring on `SCRIPT`. Pass its env to `new <Cli>Agent(env)`
    (Bun ignores `process.env.PATH` changes). Pick the behaviour with a `FAKE_<CLI>_MODE` variable and log argv,
    stdin, the working directory, the config it was given and its environment to a file the test reads. Modes, at
    least: an answer (default); `tool` (a `#!/usr/bin/env bun` call of `read_diff` on the MCP URL it was given, as
    in `apps/server/tests/helpers/fake-claude-agent.ts`); `auth`; `limit`; `garbage` (output that is not the CLI's
    format, carrying `Authorization: Bearer <fake credential>`); `flood` (more output than the cap); `crash`; and
    `spawn` (starts `sleep 30`, writes `<own pid> <child pid>` to `<log>.pids`, and waits).
11. `apps/server/tests/agents/<cli>/<cli>-run.test.ts` and `<cli>.test.ts`, each under 500 lines, with one test each
    for:
    - the tool boundary: the argv turns the CLI's own tools off, passes only Recoder's MCP server, and runs in an
      empty directory; a run without tools passes no MCP server;
    - no user config: a fake user config with a hook and an MCP server, and the config the CLI ran under has
      neither, and turns imports off;
    - the event parser: steps, usage, text, reasoning;
    - a later prompt resumes the session;
    - the failure modes: `testPromptFailures(openRun, cases)` from
      `apps/server/tests/helpers/native-agent.ts` runs one `{ mode, status, message, usageLimit? }` row per fake
      mode — signed out is a 401 naming the sign-in command, a usage cap is a `UsageLimitError`, and the rest map
      to their status. `testCallFailures(complete, cases)` does the same for `complete()` calls in `<cli>.test.ts`;
    - malformed output fails the prompt, and the error does not contain the fake credential;
    - the output cap: `testOutputCapPrompt(openRun)` (`native-agent.ts`) checks `flood` stops the CLI with
      "printed more than";
    - abort and timeout: call `testPromptStops(() => openRun('spawn'))` from
      `apps/server/tests/helpers/native-agent.ts`; it checks that aborting kills the whole process group
      (`spawnedPids`, `allGone` in `apps/server/tests/helpers/fake-claude.ts`) and that a timeout says "timed out";
    - cleanup: after `await run.close()`, on a prompt that succeeded and on one that failed, the saved session and
      the temporary config are gone. Await `close()`; never sleep;
    - one `fixtureReview(new <Cli>Agent(env), '<model>')` (`native-agent.ts`) in `tool` mode: the review completes
      through the shared engine and reads the diff through the gate.

### 5. Check

12. Run, and fix every failure:

    ```
    bunx prettier --write <changed paths>
    bunx eslint --fix <changed paths>
    bun run --filter @recoder/shared check
    bun run --filter @recoder/shared test
    bun run --filter @recoder/server check
    bun run --filter @recoder/server lint
    bun run --filter @recoder/server test
    bun run deadcode
    ```

Nothing else changes: the routes, Settings, the pickers, model routing, retries, the limiter, the failure messages,
`recoder models` and `recoder doctor` all read the adapter through the registry.
