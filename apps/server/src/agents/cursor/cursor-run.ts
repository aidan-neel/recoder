import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli, type CliExit } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import { CursorReader } from './cursor-output';
import { cursorEnv, writeCursorConfig } from './cursor-process';

type Env = Record<string, string | undefined>;

/**
 * How long a prompt's process group is given to exit on its own once the `result` event arrives: current CLI
 * versions can print the terminal result and keep a worker alive, so the group is killed after this grace.
 */
const RESULT_SETTLE_MS = 250;

/** What a run needs of the adapter: the binary, the server's environment, and the sets its `stop` empties. */
export interface CursorHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
}

/** A run's dirs under one scratch dir: the isolated config root, the data dir, the working directory, its env. */
interface RunPlace {
	root: string;
	config: string;
	data: string;
	cwd: string;
	env: Record<string, string>;
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
 * shell, file, edit, search and web tools are denied in the isolated config it runs under.
 */
export class CursorRun extends ProcessRun {
	private chatId: string | null = null;
	private used: TokenUsage | null = null;
	private settle: ReturnType<typeof setTimeout> | null = null;

	private constructor(
		private readonly host: CursorHost,
		options: AgentRunOptions,
		private readonly place: RunPlace
	) {
		super(options);
	}

	static async open(host: CursorHost, options: AgentRunOptions): Promise<CursorRun> {
		const root = await mkdtemp(join(tmpdir(), 'recoder-cursor-run-'));

		host.scratch.add(root);

		const place: RunPlace = {
			root,
			config: join(root, 'config'),
			data: join(root, 'data'),
			cwd: join(root, 'work'),
			env: {
				...cursorEnv(host.env),
				CURSOR_CONFIG_DIR: join(root, 'config'),
				CURSOR_DATA_DIR: join(root, 'data')
			}
		};

		const run = new CursorRun(host, options, place);

		try {
			await writeCursorConfig(place, host.env, run.lease);

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
		const finished = new AbortController();

		const reader = new CursorReader({
			text: (delta, partId) => this.options.onEvent({ type: 'text', delta, partId }),
			reasoning: (delta, partId) => this.options.onEvent({ type: 'reasoning', delta, partId }),
			activity: () => this.options.onEvent({ type: 'activity' }),
			problem: (message) => this.options.onEvent({ type: 'error', message }),
			result: () => {
				this.settle = setTimeout(() => finished.abort(), RESULT_SETTLE_MS);
				this.settle.unref();
			}
		});

		const lines = new LineSplitter(reader.line);
		const asked = options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;
		const stdin = this.chatId ? asked : `${this.options.system}\n\n${asked}`;

		this.options.onEvent({ type: 'step-start' });

		try {
			const exit = await streamCli({
				argv: [this.host.path, ...this.args()],
				cwd: this.place.cwd,
				env: this.place.env,
				stdin,
				signal: AbortSignal.any([deadline.signal, finished.signal]),
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.host.running,
				name: 'Cursor'
			});

			lines.end();

			return this.finish(reader, exit);
		} catch (error) {
			lines.end();

			if (reader.finished) return this.finish(reader, { code: 0, stderr: '' });

			return { text: '', error: deadline.failure(error, 'Cursor run failed.') };
		} finally {
			if (this.settle) clearTimeout(this.settle);
			this.settle = null;
			this.chatId = reader.sessionId ?? this.chatId;
		}
	}

	/** Deletes the run's scratch dir, which holds the isolated config, its chats and the data dir. */
	protected override async cleanUp(): Promise<void> {
		this.host.scratch.delete(this.place.root);
		await rm(this.place.root, { recursive: true, force: true });
	}

	private args(): string[] {
		return [
			'-p',
			'--output-format',
			'stream-json',
			'--stream-partial-output',
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
