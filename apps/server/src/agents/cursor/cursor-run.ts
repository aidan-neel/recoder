import type { TokenUsage } from '@recoder/shared';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { removeScratchDir, scratchDir } from '../cli-process';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import type { CliExit } from '../cli-stream';
import { ProcessRun } from '../process-run';
import { CursorReader } from './cursor-output';
import { PRINT_ARGS, streamPrintCall } from './cursor-print';
import { cursorPlace, writeCursorConfig, type CursorPlace } from './cursor-process';

type Env = Record<string, string | undefined>;

/** What a run needs of the adapter: the binary, the server's environment, and the sets its `stop` empties. */
export interface CursorHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
}

/** The counted fields a cumulative usage total carries, differenced one by one. */
const COUNTED = [
	'inputTokens',
	'outputTokens',
	'cachedInputTokens',
	'cacheWriteInputTokens',
	'reasoningOutputTokens'
] as const;

/**
 * The prompt's usage when the CLI reports the session's running total: the earlier total is taken off field by
 * field. A total that shrinks means the CLI reported this prompt alone, so it is used as it is.
 */
function promptUsage(total: TokenUsage, before: TokenUsage | null): TokenUsage {
	if (!before) return total;

	const diff: TokenUsage = {
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		cachedInputTokens: null,
		cacheWriteInputTokens: null,
		reasoningOutputTokens: null
	};

	for (const key of COUNTED) {
		const now = total[key];

		diff[key] = now === null ? null : now - (before[key] ?? 0);
	}

	diff.totalTokens =
		diff.inputTokens !== null && diff.outputTokens !== null ? diff.inputTokens + diff.outputTokens : null;

	const shrank = COUNTED.some((key) => {
		const value = diff[key];

		return value !== null && value < 0;
	});

	return shrank ? total : diff;
}

/**
 * Cursor as the agent: one `cursor-agent -p` process per prompt, in print mode with `stream-json` output. The
 * first prompt carries the system prompt, since the CLI has no flag for one; each later prompt resumes the chat
 * the first saved with `--resume`. Recoder's tools reach it over MCP as the only allowed server; the CLI's own
 * shell, file, edit and web tools are denied in the isolated config it runs under, and on CLIs with read access
 * (Cursor 3.23+) its file reads and searches are bounded to the empty working directory.
 */
export class CursorRun extends ProcessRun {
	private chatId: string | null = null;
	private used: TokenUsage | null = null;

	private constructor(
		private readonly host: CursorHost,
		options: AgentRunOptions,
		private readonly place: CursorPlace
	) {
		super(options);
	}

	static async open(host: CursorHost, options: AgentRunOptions): Promise<CursorRun> {
		const root = await scratchDir(host.scratch, 'recoder-cursor-run-');

		const run = new CursorRun(host, options, cursorPlace(root, host.env));

		try {
			await writeCursorConfig(run.place, run.lease);

			return run;
		} catch (error) {
			await run.close();
			throw error;
		}
	}

	/**
	 * Runs the agent on `text` until it answers. The prompt goes in on stdin; `stream-json` carries the events,
	 * and the `result` event is the answer's boundary — the process is stopped shortly after it arrives.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const deadline = this.begin(options.timeoutMs);
		const asked = options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;
		const stdin = this.chatId ? asked : `${this.options.system}\n\n${asked}`;

		this.options.onEvent({ type: 'step-start' });

		const outcome = await streamPrintCall({
			argv: [this.host.path, ...this.args()],
			cwd: this.place.cwd,
			env: this.place.env,
			stdin,
			signal: deadline.signal,
			running: this.host.running,
			name: 'Cursor',
			handlers: {
				text: (delta, partId) => this.options.onEvent({ type: 'text', delta, partId }),
				reasoning: (delta, partId) => this.options.onEvent({ type: 'reasoning', delta, partId }),
				activity: () => this.options.onEvent({ type: 'activity' }),
				problem: (message) => this.options.onEvent({ type: 'error', message })
			}
		});

		this.chatId = outcome.reader.sessionId ?? this.chatId;

		if (!outcome.ok) return { text: '', error: deadline.failure(outcome.error, 'Cursor run failed.') };

		return this.finish(outcome.reader, outcome.exit);
	}

	/** Deletes the run's scratch dir, which holds the isolated config, its chats and the data dir. */
	protected override async cleanUp(): Promise<void> {
		await removeScratchDir(this.host.scratch, this.place.root);
	}

	private args(): string[] {
		return [
			...PRINT_ARGS,
			'--trust',
			'--approve-mcps',
			'--workspace',
			this.place.cwd,
			'--model',
			this.options.model,
			...(this.chatId ? ['--resume', this.chatId] : [])
		];
	}

	/** The prompt's answer, or its error, with the usage the CLI reported, emitted as the step's end. */
	private finish(reader: CursorReader, exit: CliExit): AgentReply {
		const reported = reader.usage();
		const tokens = reported ? this.accounted(reported) : undefined;

		if (tokens) this.options.onEvent({ type: 'usage', usage: tokens });

		const error = reader.failure(exit);

		return error ? { text: reader.answer(), error, tokens } : { text: reader.answer(), tokens };
	}

	/**
	 * The prompt's own usage. A cumulative session total is differenced against the last one and becomes the new
	 * baseline; a per-call `step_finish` sum is used as it is and leaves the baseline alone.
	 */
	private accounted(reported: { usage: TokenUsage; cumulative: boolean }): TokenUsage {
		if (!reported.cumulative) return reported.usage;

		const usage = promptUsage(reported.usage, this.used);

		this.used = reported.usage;

		return usage;
	}
}
