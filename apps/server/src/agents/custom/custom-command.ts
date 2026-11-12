import {
	supportedEffort,
	type AgentStatus,
	type ModelEntry,
	type ModelFailure,
	type ReasoningEffort,
	type TokenUsage
} from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import { cliFailure } from '../cli-failure';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from '../../models/llm/types';
import { callDeadline, cliEnv, emptyDirectory, killGroup, stopOnShutdown } from '../cli-process';
import { systemText } from '../cli-prompt';
import type { AgentAdapter, AgentEvent, AgentModelSettings, AgentRun, AgentRunOptions } from '../contract';
import { CUSTOM_AGENT_VAR, DEFAULT_NAME, readCustomCommand, type CustomCommand } from './custom-config';
import { runDescribe, runTurn, type CommandHost } from './custom-invoke';
import { PROTOCOL, PROTOCOL_VERSION, type TurnRequest } from './custom-protocol';
import { CustomRun } from './custom-run';

type Env = Record<string, string | undefined>;

const ID = 'custom-command';

const INSTALL = `Set ${CUSTOM_AGENT_VAR} to {"argv": ["/path/to/agent"]}; see docs/agents/custom-command.md.`;

/** How long `describe` may take: it is asked on every status check and model listing. */
const DESCRIBE_TIMEOUT_MS = 10_000;

/**
 * Variables the command must not inherit from the server: the server's own settings and keys, and any token or
 * secret, so a command never sees the forge token or a provider key it was not given. It keeps the rest: PATH,
 * HOME, locale, temp and XDG dirs, proxies.
 */
const STRIPPED = [/^RECODER_/, /^OPENAI_/, /^ANTHROPIC_/, /^GH_TOKEN$/, /_TOKEN$/, /_API_KEY$/, /SECRET/, /PASSWORD/];

/** Usage summed over a call's steps, as `onUsage` takes it: the latest total, not a delta. */
function addUsage(total: TokenUsage | null, step: TokenUsage): TokenUsage {
	if (!total) return step;

	const sum = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

	return {
		inputTokens: sum(total.inputTokens, step.inputTokens),
		outputTokens: sum(total.outputTokens, step.outputTokens),
		totalTokens: sum(total.totalTokens, step.totalTokens),
		cachedInputTokens: sum(total.cachedInputTokens, step.cachedInputTokens),
		cacheWriteInputTokens: sum(total.cacheWriteInputTokens, step.cacheWriteInputTokens),
		reasoningOutputTokens: sum(total.reasoningOutputTokens, step.reasoningOutputTokens)
	};
}

/**
 * A command the user configures in {@link CUSTOM_AGENT_VAR}, spoken to through the versioned protocol in
 * `custom-protocol.ts`: a JSON request on stdin, JSON events on stdout. It manages its own sign-in; Recoder runs
 * it as configured, never through a shell, without the server's secrets in its environment.
 */
export class CustomCommandAgent implements AgentAdapter {
	readonly id = ID;
	/** A command may be a thin client of a server that takes many calls at once, so it shares the endpoint ceiling. */
	readonly processCeiling = null;
	readonly signInFix =
		'Check that the custom command is signed in and lists the model, or pick another model in Recoder settings.';

	private readonly running = new Set<Bun.Subprocess>();
	private status: AgentStatus | null = null;

	/** The last model list, by model id, for efforts. */
	private known = new Map<string, ModelEntry>();

	constructor(private readonly env: Env = process.env) {}

	get name(): string {
		const config = readCustomCommand(this.env);

		return config.kind === 'ready' ? config.command.name : DEFAULT_NAME;
	}

	/** Configured and found, and the version its `describe` reports. Cached until `refresh`. */
	async detect(refresh = false): Promise<AgentStatus> {
		if (this.status && !refresh) return this.status;

		const config = readCustomCommand(this.env);

		const status: AgentStatus = {
			id: this.id,
			name: this.name,
			installed: config.kind !== 'unset',
			version: null,
			path: config.kind === 'ready' ? config.command.argv[0] : null,
			error: config.kind === 'invalid' ? config.error : null,
			install: INSTALL,
			signedIn: null,
			login: null,
			providers: false
		};

		if (config.kind === 'ready') {
			try {
				status.version = (
					await runDescribe(await this.host(config.command), AbortSignal.timeout(DESCRIBE_TIMEOUT_MS))
				).agentVersion;
			} catch (error) {
				status.error = error instanceof Error ? error.message : `${config.command.name} could not be run.`;
			}
		}

		return (this.status = status);
	}

	/** Its `describe` takes no model call and starts nothing that outlives it. */
	quickStatus(): Promise<AgentStatus> {
		return this.detect();
	}

	/** Whether a command is configured; a configured one that cannot run says so when it is asked. */
	installed(): boolean {
		return readCustomCommand(this.env).kind !== 'unset';
	}

	/** What `describe` lists. When `signal` aborts, the command is killed and the listing rejects. */
	async models(signal?: AbortSignal): Promise<ModelEntry[]> {
		const timeout = AbortSignal.timeout(DESCRIBE_TIMEOUT_MS);
		const stop = signal ? AbortSignal.any([timeout, signal]) : timeout;
		const described = await runDescribe(await this.host(this.command()), stop);

		const entries = described.models.map((model): ModelEntry => ({
			id: `${ID}:${model.id}`,
			provider: ID,
			label: model.label,
			model: model.id,
			baseUrl: null,
			apiKeyPreview: null,
			...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
			...(model.efforts === undefined ? {} : { efforts: model.efforts }),
			...(model.defaultEffort === undefined ? {} : { defaultEffort: model.defaultEffort })
		}));

		this.known = new Map(entries.map((entry) => [entry.model, entry]));

		return entries;
	}

	/** The picked effort when the model offers it, else its default; any effort when its levels are not known. */
	modelSettings(model: string, requested: ReasoningEffort | undefined): AgentModelSettings {
		const entry = this.known.get(model);

		return {
			reasoningEffort: supportedEffort(requested ?? entry?.defaultEffort, entry?.efforts, entry?.defaultEffort)
		};
	}

	/** One turn without tools. Text streams to `onToken`; usage is summed over the command's steps. */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const command = this.command();
		const deadline = callDeadline(opts);
		let used: TokenUsage | null = null;

		const onEvent = (event: AgentEvent) => {
			if (event.type === 'text') onToken?.(event.delta);
			else if (event.type === 'reasoning') opts.onReasoning?.(event.delta);
			else if (event.type === 'usage') opts.onUsage?.((used = addUsage(used, event.usage)));
		};

		try {
			const result = await runTurn(await this.host(command), this.completeRequest(opts), deadline.signal, onEvent);

			return result.text || (result.structured === undefined ? '' : JSON.stringify(result.structured));
		} catch (error) {
			throw deadline.failure(error, `${command.name} failed.`);
		}
	}

	/** Only a command's `describe` lists its models. */
	fixedModels(): null {
		return null;
	}

	async openRun(options: AgentRunOptions): Promise<AgentRun> {
		return new CustomRun(await this.host(this.command()), options);
	}

	describeFailure(err: LlmError, fallback: string): ModelFailure {
		return cliFailure(this, err, fallback);
	}

	stop(): void {
		for (const proc of this.running) killGroup(proc);
	}

	/** The configured command; throws when there is none or it is invalid. */
	private command(): CustomCommand {
		const config = readCustomCommand(this.env);

		if (config.kind === 'unset') throw new LlmError(0, `No custom command is configured. ${INSTALL}`);
		if (config.kind === 'invalid') throw new LlmError(0, config.error);

		return config.command;
	}

	/** Where the command runs: an empty directory, with the server's secrets left out of its environment. */
	private async host(command: CustomCommand): Promise<CommandHost> {
		return {
			command,
			env: cliEnv(this.env, STRIPPED),
			cwd: await emptyDirectory('custom-command-empty'),
			running: this.running
		};
	}

	private completeRequest(opts: ChatOptions): TurnRequest {
		return {
			protocol: PROTOCOL,
			version: PROTOCOL_VERSION,
			kind: 'turn',
			model: opts.model,
			reasoningEffort: opts.reasoningEffort ?? null,
			system: systemText(opts),
			messages: opts.messages.flatMap((message) =>
				message.role === 'system' ? [] : [{ role: message.role, content: message.content }]
			),
			session: null,
			tools: [],
			mcp: null,
			schema: opts.jsonSchema?.schema ?? null,
			timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
		};
	}
}

export const customCommand = new CustomCommandAgent();

stopOnShutdown(ID, () => customCommand.stop());
