import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { SessionRun, type SessionHost } from '../session-run';
import { CodexReader, type SessionUsage } from './codex-output';
import { callArgs, codexEnv } from './codex-process';

/** A run's files, under its scratch dir: the system prompt the CLI takes in place of its own, and the empty working directory. */
interface RunFiles {
	system: string;
	cwd: string;
}

/**
 * Codex as the agent: one `codex exec` process per prompt, each later one resuming the session the first saved.
 * The CLI's own tools are off and Recoder's reach it over MCP; the review gate behind them decides what each call
 * may do. The session is kept until the run closes, since `--ephemeral` saves nothing to resume.
 */
export class CodexRun extends SessionRun<RunFiles> {
	private sessionTotal: SessionUsage | null = null;

	static async open(host: SessionHost, options: AgentRunOptions): Promise<CodexRun> {
		const root = await SessionRun.scratchDirectory('codex');
		const files = { system: join(root, 'system.md'), cwd: join(root, 'work') };

		return SessionRun.ready(new CodexRun(host, options, root, files), async () => {
			await writeFile(files.system, options.system, { mode: 0o600 });
			await mkdir(files.cwd);
		});
	}

	/**
	 * Runs the agent on `text` until it answers. `--output-schema` is not used: it makes the API enforce the schema
	 * strictly, which Recoder's schemas are not written for, so JSON is asked for in words. The tools stay listed on
	 * the final turn, since a resumed session keeps its MCP server; the gate refuses them then.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const deadline = this.begin(options.timeoutMs);
		const reader = new CodexReader(this.options.onEvent, `codex_${++this.prompts}`, this.sessionTotal);
		const lines = new LineSplitter(reader.line);

		try {
			const exit = await streamCli({
				argv: [this.host.path, ...this.args()],
				cwd: this.files.cwd,
				env: codexEnv(this.host.env),
				stdin: options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text,
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.host.running,
				name: 'Codex'
			});

			lines.end();

			return reader.finish(exit);
		} catch (error) {
			return { text: '', error: deadline.failure(error, 'Codex run failed.') };
		} finally {
			this.session ??= reader.session;
			this.sessionTotal = reader.sessionTotal;
		}
	}

	/** `codex exec … -` for the first prompt; `codex exec resume … <session> -` for each later one. The prompt is on stdin. */
	private args(): string[] {
		const flags = callArgs({
			model: this.options.model,
			reasoningEffort: this.options.reasoningEffort,
			systemFile: this.files.system,
			lease: this.lease
		});

		return this.session ? ['exec', 'resume', ...flags, this.session, '-'] : ['exec', ...flags, '-'];
	}
}
