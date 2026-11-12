import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { removeScratchDir, scratchDir } from '../cli-process';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import { grokEnv, prepareHome, realAuthPath, writeLeaseConfig } from './grok-process';
import { RunReader } from './grok-run-reader';

type Env = Record<string, string | undefined>;

/** The empty directory the CLI runs in for calls that configure no MCP server (status checks, `complete`). */
export const GROK_EMPTY_DIR = 'grok-empty';

/**
 * Print mode with every built-in tool off, shared by single calls and runs: only the meta-tools that reach
 * Recoder's MCP server stay (`search_tool` finds them, `use_tool` calls them), subagents, plan mode and web
 * search are off, and `bypassPermissions` keeps a headless run from stalling on a prompt for a tool that is
 * already gone. `--trust` marks the call's own directory trusted so its project config loads.
 */
export const PRINT_ARGS = [
	'--output-format',
	'streaming-messages-json',
	'--include-partial-messages',
	'--tools',
	'search_tool,use_tool',
	'--no-subagents',
	'--no-plan',
	'--disable-web-search',
	'--permission-mode',
	'bypassPermissions',
	'--trust'
];

/** What a run needs of the adapter: the binary, the server's environment, and the sets its `stop` empties. */
interface GrokHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
}

/** Where a run lives: its scratch dir (home, working directory, prompt file), all removed together on close. */
interface RunPlace {
	root: string;
	home: string;
	cwd: string;
	prompt: string;
}

/**
 * Grok Build as the agent: one `grok -p`-style process per prompt (`--prompt-file`), in one session each later
 * prompt resumes with `-r`. The CLI's own tools are off; Recoder's reach it over the MCP server its project config
 * names, and the review gate behind them decides what each call may do.
 */
export class GrokRun extends ProcessRun {
	private readonly session = randomUUID();
	private sessionStarted = false;

	private constructor(
		private readonly host: GrokHost,
		options: AgentRunOptions,
		private readonly place: RunPlace
	) {
		super(options);
	}

	static async open(host: GrokHost, options: AgentRunOptions): Promise<GrokRun> {
		const root = await scratchDir(host.scratch, 'recoder-grok-run-');

		prepareHome(join(root, 'home'), realAuthPath(host.env));
		await mkdir(join(root, 'work'), { recursive: true });

		const place: RunPlace = {
			root,
			home: join(root, 'home'),
			cwd: join(root, 'work'),
			prompt: join(root, 'prompt.md')
		};

		const run = new GrokRun(host, options, place);

		try {
			await writeLeaseConfig(place.cwd, run.lease);
		} catch (error) {
			await run.close();
			throw error;
		}

		return run;
	}

	/**
	 * Runs the agent on `text` until it answers. The system prompt goes in `--system-prompt-override` and the
	 * prompt in a file, since a review's diff can pass the kernel's per-argument limit. JSON is asked for in words
	 * on the final turn: Grok's `--json-schema` runs as a tool call, which this run's tools cannot make.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const asked = options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;
		const deadline = this.begin(options.timeoutMs);
		const reader = new RunReader(this.options.onEvent);
		const lines = new LineSplitter(reader.line);

		try {
			await writeFile(this.place.prompt, asked, { mode: 0o600 });

			const exit = await this.exec(deadline.signal, lines.push);

			lines.end();

			return reader.finish(exit);
		} catch (error) {
			return { text: '', error: deadline.failure(error, 'Grok Build run failed.') };
		} finally {
			this.sessionStarted ||= reader.sessionStarted;
		}
	}

	/** One `grok` process for the prompt file just written, printing its structured stream for `onOutput`. */
	private exec(signal: AbortSignal, onOutput: (piece: string) => void) {
		return streamCli({
			name: 'Grok Build',
			running: this.host.running,
			argv: [this.host.path, ...this.args()],
			cwd: this.place.cwd,
			env: grokEnv(this.host.env, this.place.home, realAuthPath(this.host.env)),
			stdin: null,
			signal,
			maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
			onOutput
		});
	}

	/** Deletes the run's whole scratch dir: home (and the sessions it saved), working directory and prompt file. */
	protected override async cleanUp(): Promise<void> {
		await removeScratchDir(this.host.scratch, this.place.root);
	}

	private args(): string[] {
		return [
			'--prompt-file',
			this.place.prompt,
			'--model',
			this.options.model,
			'--system-prompt-override',
			this.options.system,
			...PRINT_ARGS,
			...(this.sessionStarted ? ['-r', this.session] : ['-s', this.session])
		];
	}
}
