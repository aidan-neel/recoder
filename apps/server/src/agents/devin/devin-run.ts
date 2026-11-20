import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { CLI_OUTPUT_CAP_BYTES, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { SessionRun, type SessionHost } from '../session-run';
import type { ToolLease } from '../tools/mcp-host';
import { usageDelta } from '../usage-delta';
import { exitError, readExport, tokenUsage, type DevinExport } from './devin-output';
import { devinEnv, runConfig } from './devin-process';
import { withDevinRetries } from './devin-retry';
import { retainDevinExport } from './devin-artifacts';

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

/**
 * Devin as the agent: one `devin -p` process per prompt, each later one resuming the session the first saved. The
 * CLI prints only its answer and reports usage in its export, so each prompt is one step whose text streams as it
 * is printed. Recoder's tools reach it over MCP; the review gate behind them decides what each call may do.
 */
export class DevinRun extends SessionRun<RunFiles> {
	private used: TokenUsage | null = null;
	private turnsMissing = false;

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
		let continued = false;
		let answer = '';
		let usageRead = true;

		try {
			return await withDevinRetries<AgentReply>(deadline.signal, async () => {
				answer = '';

				const next = continued
					? `Continue the interrupted request from your saved session. Do not repeat completed tools or work. Finish your answer.${options.schema ? `\n\n${JSON_MODE_INSTRUCTION}` : ''}`
					: asked;

				await writeFile(this.files.prompt, this.session ? next : `${this.options.system}\n\n${next}`, {
					mode: 0o600
				});

				this.options.onEvent({ type: 'step-start' });
				await rm(this.files.export, { force: true });
				usageRead = false;

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

				usageRead = true;

				if (exit.code !== 0)
					return {
						value: { text: answer, error: exitError(exit, answer), tokens },
						errorOutput: exit.stderr.trim() ? exit.stderr : answer,
						partial: Boolean(answer.trim()) && !/^\s*(?:error\b|HTTP\s*429\b)/i.test(answer),
						resume: this.session
							? () => {
									continued = true;
								}
							: undefined
					};

				return { value: { text: answer, tokens } };
			});
		} catch (error) {
			const tokens = !usageRead ? await this.exported() : undefined;

			return { text: answer, tokens, error: deadline.failure(error, 'Devin run failed.') };
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
		await retainDevinExport(this.files.export, this.host.env);

		const exported: DevinExport | null = await readExport(this.files.export);

		this.session = exported?.session_id ?? this.session;

		const turns = exported?.final_metrics?.total_steps;

		this.turnsMissing ||= turns === undefined;
		this.options.onEvent({ type: 'internal-turns', total: this.turnsMissing ? null : turns! });

		if (!exported?.final_metrics) return undefined;

		const total = tokenUsage(exported.final_metrics);
		const usage = usageDelta(total, this.used);

		this.used = total;
		this.options.onEvent({ type: 'usage', usage });

		return usage;
	}
}
