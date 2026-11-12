import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { CLI_OUTPUT_CAP_BYTES, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { SessionRun, type SessionHost } from '../session-run';
import type { ToolLease } from '../tools/mcp-host';
import { exitError, readExport, tokenUsage, type DevinExport } from './devin-output';
import { devinEnv, runConfig } from './devin-process';

type Env = Record<string, string | undefined>;

/**
 * Print mode. The permission mode is the CLI's strictest automatic one, and workspace trust is not asked for since
 * print mode cannot answer it. Each call also gets a config that denies the CLI's own tools.
 */
export const DEVIN_PRINT_ARGS = ['-p', '--permission-mode', 'auto', '--respect-workspace-trust', 'false'];

/** A run's files, under its scratch dir: the prompt and export files, the config home, and the working directory. */
interface RunFiles {
	prompt: string;
	export: string;
	configHome: string;
	cwd: string;
}

function runFiles(root: string): RunFiles {
	return {
		prompt: join(root, 'prompt.md'),
		export: join(root, 'export.json'),
		configHome: join(root, 'config'),
		cwd: join(root, 'work')
	};
}

/**
 * Writes a run's files: a config that denies the CLI's own tools and allows Recoder's, and a working directory
 * whose only content is the local MCP config naming Recoder's server (the CLI reads `.devin/mcp_config.local.json`
 * of the directory it runs in).
 */
async function writeRunFiles(files: RunFiles, env: Env, lease: ToolLease | null): Promise<void> {
	await Bun.write(join(files.configHome, 'devin', 'config.json'), await runConfig(env, lease?.name ?? null));
	await mkdir(files.cwd, { recursive: true });

	if (!lease) return;

	const servers = { mcpServers: { [lease.name]: { url: lease.url, transport: 'http' } } };

	await Bun.write(join(files.cwd, '.devin', 'mcp_config.local.json'), JSON.stringify(servers));
}

/** Usage of the latest prompt: a resumed session's export counts the whole session, so the earlier total is taken off. */
function promptUsage(total: TokenUsage, before: TokenUsage | null): TokenUsage {
	if (!before) return total;

	const less = (now: number | null, then: number | null) => (now === null ? null : now - (then ?? 0));
	const inputTokens = less(total.inputTokens, before.inputTokens);
	const outputTokens = less(total.outputTokens, before.outputTokens);

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: less(total.cachedInputTokens, before.cachedInputTokens),
		cacheWriteInputTokens: null,
		reasoningOutputTokens: null
	};
}

/**
 * Devin as the agent: one `devin -p` process per prompt, each later one resuming the session the first saved. The
 * CLI prints only its answer and reports usage in its export, so each prompt is one step whose text streams as it
 * is printed. Recoder's tools reach it over MCP; the review gate behind them decides what each call may do.
 */
export class DevinRun extends SessionRun<RunFiles> {
	private used: TokenUsage | null = null;

	static async open(host: SessionHost, options: AgentRunOptions): Promise<DevinRun> {
		const root = await SessionRun.scratchDirectory('devin');
		const run = new DevinRun(host, options, root, runFiles(root));

		return SessionRun.ready(run, () => writeRunFiles(run.files, host.env, run.lease));
	}

	/** Runs the agent on `text` until it answers. Devin takes no system prompt, so the first prompt carries it. */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const deadline = this.begin(options.timeoutMs);
		const partId = `devin_${++this.prompts}`;
		const asked = options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;
		let answer = '';

		await writeFile(this.files.prompt, this.session ? asked : `${this.options.system}\n\n${asked}`, { mode: 0o600 });
		this.options.onEvent({ type: 'step-start' });

		try {
			const exit = await streamCli({
				argv: [this.host.path, ...this.args()],
				cwd: this.files.cwd,
				env: { ...devinEnv(this.host.env), XDG_CONFIG_HOME: this.files.configHome },
				stdin: null,
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: (piece) => {
					answer += piece;
					this.options.onEvent({ type: 'text', delta: piece, partId });
				},
				running: this.host.running,
				name: 'Devin'
			});

			const tokens = await this.exported();

			if (exit.code !== 0) return { text: answer, error: exitError(exit, answer), tokens };

			return { text: answer, tokens };
		} catch (error) {
			await this.exported();

			return { text: answer, error: deadline.failure(error, 'Devin run failed.') };
		}
	}

	private args(): string[] {
		const resume = this.session ? ['--resume', this.session] : [];

		return [
			...DEVIN_PRINT_ARGS,
			'--prompt-file',
			this.files.prompt,
			'--model',
			this.options.model,
			'--export',
			this.files.export,
			...resume
		];
	}

	/**
	 * Reads the export the prompt left: the session to resume next, and the prompt's usage, which is reported as
	 * the end of its step. Null when the CLI exported nothing.
	 */
	private async exported(): Promise<TokenUsage | undefined> {
		const exported: DevinExport | null = await readExport(this.files.export);

		this.session = exported?.session_id ?? this.session;

		if (!exported?.final_metrics) return undefined;

		const total = tokenUsage(exported.final_metrics);
		const usage = promptUsage(total, this.used);

		this.used = total;
		this.options.onEvent({ type: 'usage', usage });

		return usage;
	}
}
