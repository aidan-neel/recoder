import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { emptyDirectory } from '../cli-process';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import type { ToolLease } from '../tools/mcp-host';
import { effortArgs } from './claude-code-models';
import { claudeCodeEnv } from './claude-code-process';
import { RunReader } from './claude-code-run-reader';
import { forgetSession } from './claude-code-session';

type Env = Record<string, string | undefined>;

/** The empty directory the CLI runs in, shared with single calls so their saved sessions are swept together. */
export const CLAUDE_CODE_EMPTY_DIR = 'claude-code-empty';

/** Settings passed on the command line: no hook of the user's or of a plugin runs a command. */
const NO_HOOKS = JSON.stringify({ disableAllHooks: true });

/**
 * Print mode for an agent run. No built-in tool (`--tools ""`), so the CLI has no shell, file, edit or web tool
 * of its own; no settings file (`--setting-sources ""`) and no hooks; only the MCP server Recoder passes
 * (`--strict-mcp-config`); no slash commands. `--safe-mode` is not used here: it drops the `--mcp-config`
 * servers too. `dontAsk` refuses any tool that is not allowed, and only Recoder's server is.
 */
const RUN_ARGS = [
	'-p',
	'--setting-sources',
	'',
	'--settings',
	NO_HOOKS,
	'--strict-mcp-config',
	'--disable-slash-commands',
	'--tools',
	'',
	'--permission-mode',
	'dontAsk',
	'--output-format',
	'stream-json',
	'--verbose',
	'--include-partial-messages'
];

/** What a run needs of the adapter: the binary, the server's environment, and the sets its `stop` empties. */
export interface ClaudeCodeHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
}

/** Where a run lives: its scratch dir (the system prompt file) and the working directory. */
interface RunPlace {
	scratch: string;
	cwd: string;
}

/** The `--mcp-config` and `--allowedTools` flags that give the CLI Recoder's tools, and nothing else. */
function toolArgs(lease: ToolLease | null): string[] {
	if (!lease) return [];

	const config = JSON.stringify({ mcpServers: { [lease.name]: { type: 'http', url: lease.url } } });

	return ['--mcp-config', config, '--allowedTools', `mcp__${lease.name}`];
}

/**
 * Claude Code as the agent: one `claude -p` process per prompt, in one saved session that each later prompt
 * resumes. The CLI calls Recoder's tools over MCP; the review gate behind them decides what each call may do.
 */
export class ClaudeCodeRun extends ProcessRun {
	private readonly session = randomUUID();
	private sessionStarted = false;

	private constructor(
		private readonly host: ClaudeCodeHost,
		options: AgentRunOptions,
		private readonly place: RunPlace
	) {
		super(options);
	}

	static async open(host: ClaudeCodeHost, options: AgentRunOptions): Promise<ClaudeCodeRun> {
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-claude-code-run-'));

		host.scratch.add(scratch);
		await writeFile(join(scratch, 'system.md'), options.system, { mode: 0o600 });

		return new ClaudeCodeRun(host, options, { scratch, cwd: await emptyDirectory(CLAUDE_CODE_EMPTY_DIR) });
	}

	/**
	 * Runs the agent on `text` until it answers. The CLI cannot enforce a schema with its built-in tools off, so
	 * JSON is asked for in words. Its tools stay listed on the final turn, since a resumed session that used them
	 * must still declare them; the gate refuses them then.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const deadline = this.begin(options.timeoutMs);
		const reader = new RunReader(this.options.onEvent);
		const lines = new LineSplitter(reader.line);

		try {
			const exit = await streamCli({
				argv: [this.host.path, ...this.args()],
				cwd: this.place.cwd,
				env: claudeCodeEnv(this.host.env),
				stdin: options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text,
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.host.running,
				name: 'Claude Code'
			});

			lines.end();

			return reader.finish(exit);
		} catch (error) {
			return { text: '', error: deadline.failure(error, 'Claude Code run failed.') };
		} finally {
			this.sessionStarted ||= reader.sessionStarted;
		}
	}

	/** Deletes the system prompt file and the session the CLI saved. */
	protected override async cleanUp(): Promise<void> {
		this.host.scratch.delete(this.place.scratch);
		await rm(this.place.scratch, { recursive: true, force: true });
		forgetSession(this.host.env, this.place.cwd, this.session);
	}

	private args(): string[] {
		const { options, place } = this;

		return [
			...RUN_ARGS,
			...toolArgs(this.lease),
			'--model',
			options.model,
			...effortArgs(options),
			'--system-prompt-file',
			join(place.scratch, 'system.md'),
			...(this.sessionStarted ? ['--resume', this.session] : ['--session-id', this.session])
		];
	}
}
