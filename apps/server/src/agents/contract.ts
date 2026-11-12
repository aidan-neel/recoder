import type { AgentStatus, ModelEntry, ModelFailure, ReasoningEffort, TokenUsage } from '@recoder/shared';
import type { LlmError } from '../models/llm/errors';
import type { ChatOptions } from '../models/llm/types';

/**
 * The contract every agent CLI adapter implements. `docs/agents/adapter-contract.md` explains it; the registry
 * (`registry.ts`) lists the adapters, and nothing outside `agents/` names a CLI.
 *
 * Tool boundary: an adapter never lets its CLI use its own shell, file, edit or network tools. The only way a
 * run reaches the repository is {@link AgentRunOptions.runTool}, served to the CLI over MCP by
 * `tools/mcp-host.ts`, which passes each call to Recoder's gate (permitted reads, sandboxed runs).
 */
export interface AgentAdapter {
	/** The adapter id: also the model provider, and the prefix of its model ids (`claude-code:opus`). */
	readonly id: string;
	readonly name: string;
	/**
	 * How many of its calls may run at once when each starts a process, never above the shared ceiling. Null for an
	 * agent whose calls share one long-lived process (OpenCode's server); those share the endpoint ceiling.
	 */
	readonly processCeiling: ProcessCeiling | null;
	/** What `recoder doctor` tells someone whose model the agent does not list, which is how a missing sign-in shows. */
	readonly signInFix: string;
	/** Installed, version, sign-in state. Cached until `refresh`. */
	detect(refresh?: boolean): Promise<AgentStatus>;
	/** The status `recoder doctor` reports, found without starting anything that outlives the check. */
	quickStatus(): Promise<AgentStatus>;
	/** Whether the CLI is found (or, for a custom command, configured), answered without running it. */
	installed(): boolean;
	/**
	 * Models it can run now, with ids `<id>:<model>`; throws when the agent is missing or down. When `signal` aborts,
	 * a listing that runs the CLI kills it and rejects.
	 */
	models(signal?: AbortSignal): Promise<ModelEntry[]>;
	/**
	 * The models the adapter knows without running the CLI, offered whether or not it is installed (Claude Code's:
	 * the CLI has no command that lists them); null when only running the CLI lists them.
	 */
	fixedModels(): ModelEntry[] | null;
	/** The settings `model` (an id without the `<id>:` prefix) runs with when `requested` is the picked effort. */
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings;
	/** One model call without tools: chat replies, summaries, judges. Text streams to `onToken`. */
	complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string>;
	/** Opens a run in which the CLI is the agent, calling Recoder's tools as it goes. */
	openRun(options: AgentRunOptions): Promise<AgentRun>;
	/**
	 * Words for the developer when a call of one of its models failed with `err`; `source` is the hosted provider
	 * the model routes to, when it has one. A usage cap is a `UsageLimitError` the adapter raised.
	 */
	describeFailure(err: LlmError, fallback: string, source: string | undefined): ModelFailure;
	/** Kills every process the adapter started and deletes its scratch files; synchronous, for exit. */
	stop(): void;
}

/** A concurrency cap of its own: the env var that sets it, and the cap when that is unset. */
export interface ProcessCeiling {
	env: string;
	fallback: number;
}

/** What a model id of an agent resolves to, beyond the model: its effort and, for a router, its hosted provider. */
export interface AgentModelSettings {
	reasoningEffort?: ReasoningEffort;
	/** Hosted provider the agent routes the model to (OpenCode's `openai`…), for limits and failure messages. */
	source?: string;
}

/** What a tool call answers: the text the model reads, and whether it is a refusal or a failure. */
export interface ToolOutcome {
	text: string;
	isError: boolean;
}

/** Runs one Recoder tool call by name. The gate behind it decides what is permitted. */
export type ToolRunner = (name: string, args: unknown) => Promise<ToolOutcome>;

/**
 * What a run reports while the CLI works, the same for every CLI. A step is one model call; a prompt takes one or
 * more. `step` names the model message a step produces, when the CLI says, and pairs `usage` with `step-start`.
 */
export type AgentEvent =
	| { type: 'step-start'; step?: string }
	| { type: 'text'; delta: string; partId: string }
	| { type: 'reasoning'; delta: string; partId: string }
	| { type: 'tool-call'; name: string }
	| { type: 'tool-result'; name: string; isError: boolean }
	/** A step ended, having used this much. */
	| { type: 'usage'; usage: TokenUsage; step?: string }
	/** Something went wrong that the run survives, such as a line the parser could not read. */
	| { type: 'error'; message: string }
	/** Any other sign of life from the CLI: proof the run is still moving. */
	| { type: 'activity' };

export interface AgentRunOptions {
	model: string;
	reasoningEffort?: ReasoningEffort;
	/** The system prompt, in place of the CLI's own. */
	system: string;
	/**
	 * Recoder tools the agent may call (the native tool names: `read_file`, `run`…); none makes every prompt a
	 * single answer. The CLI runs in an empty directory, so these are its only way to the repository.
	 */
	tools: readonly string[];
	runTool: ToolRunner;
	onEvent: (event: AgentEvent) => void;
	/** Aborting it kills the CLI's whole process group. */
	signal: AbortSignal;
}

export interface AgentPromptOptions {
	/** False on the final turn: the agent may only answer. A CLI that cannot take tools away refuses them in the gate. */
	tools: boolean;
	/** The JSON schema of the answer; a CLI that cannot enforce one is asked for JSON in words. */
	schema?: Record<string, unknown>;
	/** How long the prompt may run before it is stopped as timed out. */
	timeoutMs: number;
}

/** How one prompt ended: the answer as an object or as text, or the error that stopped it. */
export interface AgentReply {
	structured?: unknown;
	text: string;
	error?: LlmError;
	/** What the prompt used in all, for a CLI whose step events never reported it. */
	tokens?: TokenUsage;
}

/**
 * One agent run. Each prompt runs the agent until it answers; a later prompt continues the same conversation, so
 * the provider's prompt cache carries over. `close` ends it and deletes what the CLI saved for it.
 */
export interface AgentRun {
	prompt(text: string, options: AgentPromptOptions): Promise<AgentReply>;
	/** Stops the prompt in progress; it then settles with a cancelled error. */
	abort(): Promise<void>;
	close(): Promise<void>;
}
