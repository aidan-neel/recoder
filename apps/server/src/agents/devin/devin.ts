import { rmSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ModelEntry, TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { LlmError, cancelledError, timedOutError } from '../../models/llm/errors';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from '../../models/llm/types';
import { emptyDirectory, findCli, killGroup, probeVersion, stopOnShutdown } from '../cli-process';
import { promptText, systemText } from '../cli-prompt';
import type { AgentAdapter } from '../registry';
import { parseDevinModels } from './devin-models';
import { devinEnv, removeToolFreeHome, toolFreeHome } from './devin-process';

type Env = Record<string, string | undefined>;

const INSTALL = 'curl -fsSL https://cli.devin.ai/install.sh | bash';

const LOGIN = 'devin auth login';

const SHORT_TIMEOUT_MS = 10_000;

const MODELS_TIMEOUT_MS = 20_000;

/**
 * Print mode over a tool-free config (see {@link toolFreeHome}). The permission mode is the CLI's strictest
 * automatic one, and workspace trust is not asked for since print mode cannot answer it. The directory is empty.
 */
const BASE_ARGS = ['-p', '--permission-mode', 'auto', '--respect-workspace-trust', 'false'];

/**
 * Tools are denied, but a model trained with them still tries one, and the CLI then ends the turn with no text.
 * This line asks for the answer in plain text.
 */
const NO_TOOLS_INSTRUCTION = 'You have no tools. Never write a tool call. Reply with plain text only.';

const SIGNED_OUT = /not logged in|log ?in required|please (?:log|sign) ?in|unauthenticated|auth login/i;

const LIMIT = /rate.?limit|quota|usage limit|too many requests|insufficient credit/i;

const exportSchema = z.object({
	session_id: z.string().optional(),
	final_metrics: z
		.object({
			total_prompt_tokens: z.number().optional(),
			total_completion_tokens: z.number().optional(),
			total_cached_tokens: z.number().optional()
		})
		.optional()
});

type Export = z.infer<typeof exportSchema>;

/** The last non-empty line, trimmed and cut, to quote in an error. */
function lastLine(text: string): string | undefined {
	const line = text.trim().split('\n').pop()?.trim();

	return line ? line.slice(0, 300) : undefined;
}

/** `prompt_tokens` already counts the cached ones, as the export's own totals show. */
function tokenUsage(metrics: NonNullable<Export['final_metrics']>): TokenUsage {
	const inputTokens = metrics.total_prompt_tokens ?? 0;
	const outputTokens = metrics.total_completion_tokens ?? 0;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		cachedInputTokens: metrics.total_cached_tokens ?? 0,
		cacheWriteInputTokens: null,
		reasoningOutputTokens: null
	};
}

/** A failed call's error: signed out is a 401 and a spent plan a 429, so the app can say so. */
function devinError(text: string): LlmError {
	if (SIGNED_OUT.test(text)) return new LlmError(401, `Devin is signed out. Run: ${LOGIN}`);

	return new LlmError(LIMIT.test(text) ? 429 : 0, text);
}

/**
 * Devin, run as one `devin -p` process per model call.
 *
 * The CLI signs in itself. Recoder never reads its credential file; it runs the CLI without the server's keys
 * in its environment and under a config that denies every tool, and reads what the CLI prints and exports.
 */
export class DevinAgent implements AgentAdapter {
	readonly id = 'devin';
	readonly name = 'Devin';
	private status: AgentStatus | null = null;
	private running = new Set<Bun.Subprocess>();
	private scratch = new Set<string>();

	constructor(private readonly env: Env = process.env) {}

	/** Installed, version, and sign-in from `devin auth status`, which makes no model call. Cached until `refresh`. */
	async detect(refresh = false): Promise<AgentStatus> {
		if (this.status && !refresh) return this.status;

		const path = this.find();

		const base: AgentStatus = {
			id: this.id,
			name: this.name,
			installed: !!path,
			version: null,
			path,
			error: null,
			install: INSTALL,
			signedIn: null,
			login: LOGIN,
			providers: false,
			authMethod: null,
			apiKeySource: null
		};

		if (!path) return (this.status = base);

		try {
			base.version = await probeVersion(path, devinEnv(this.env));
			if (!base.version) base.error = 'Devin did not report a version.';
		} catch {
			base.error = 'Devin could not be run.';
		}

		if (!base.error) base.signedIn = (await this.output(path, ['auth', 'status'], SHORT_TIMEOUT_MS)).code === 0;

		return (this.status = base);
	}

	/** The account's models, from `devin models list`; throws when the CLI is missing or the list is empty. */
	async models(): Promise<ModelEntry[]> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Devin is not installed. Install it with: ${INSTALL}`);

		const listed = parseDevinModels((await this.output(path, ['models', 'list'], MODELS_TIMEOUT_MS)).stdout);

		if (!listed.length) throw new LlmError(0, 'Devin listed no models.');

		return listed;
	}

	/**
	 * One model call. The system prompt and the turns go in a file, since a review's diff can pass the kernel's
	 * per-argument limit. The CLI prints the reply when it ends; usage comes from the conversation it exports,
	 * which is then deleted from its session store along with the files here.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const path = this.find();

		if (!path) throw new LlmError(0, `Devin is not installed. Install it with: ${INSTALL}`);

		const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
		const scratch = await mkdtemp(join(tmpdir(), 'recoder-devin-'));
		const promptFile = join(scratch, 'prompt.md');
		const exportFile = join(scratch, 'export.json');
		const cwd = await emptyDirectory('devin-empty');
		let session: string | undefined;

		this.scratch.add(scratch);

		try {
			const system = [systemText(opts), NO_TOOLS_INSTRUCTION].filter(Boolean).join('\n\n');
			const turns = opts.messages.filter((m) => m.role !== 'system');

			await writeFile(promptFile, `${system}\n\n${promptText(turns)}`, { mode: 0o600 });

			const args = [...BASE_ARGS, '--prompt-file', promptFile, '--model', opts.model, '--export', exportFile];

			const env = { ...devinEnv(this.env), XDG_CONFIG_HOME: await toolFreeHome(this.env) };
			const text = await this.run(path, args, { cwd, env }, signal, onToken);
			const exported = await this.readExport(exportFile);

			session = exported?.session_id;
			if (exported?.final_metrics) opts.onUsage?.(tokenUsage(exported.final_metrics));

			if (!text.trim()) throw new LlmError(0, 'Devin ended without a reply. It may have tried to use a tool.');

			return text;
		} catch (error) {
			session ??= (await this.readExport(exportFile))?.session_id;
			if (opts.signal?.aborted) throw cancelledError();
			if (timeout.aborted) throw timedOutError(timeoutMs);
			if (error instanceof LlmError) throw error;
			throw new LlmError(0, error instanceof Error ? error.message : 'Devin request failed.');
		} finally {
			this.scratch.delete(scratch);
			await rm(scratch, { recursive: true, force: true });
			if (session) this.forget(path, session);
		}
	}

	/** Kill every running call's process group and delete its prompt file and the tool-free config; synchronous, for exit. */
	stop(): void {
		for (const proc of this.running) killGroup(proc);
		for (const dir of this.scratch) rmSync(dir, { recursive: true, force: true });
		removeToolFreeHome();
	}

	private find(): string | null {
		return findCli({ pin: 'RECODER_DEVIN_BIN', command: 'devin', installed: ['.local', 'bin', 'devin'] }, this.env);
	}

	private async readExport(file: string): Promise<Export | null> {
		try {
			return exportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
		} catch {
			return null;
		}
	}

	/** Best effort: delete the session the CLI saved for a call, which holds the review's prompt. */
	private forget(path: string, session: string): void {
		Bun.spawn([path, 'rm', session, '--force'], {
			env: devinEnv(this.env),
			stdin: 'ignore',
			stdout: 'ignore',
			stderr: 'ignore'
		}).unref();
	}

	/** Run a short CLI command to its end, killing it after `timeoutMs`. */
	private async output(path: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
		const proc = Bun.spawn([path, ...args], { stdout: 'pipe', stderr: 'ignore', env: devinEnv(this.env) });
		const timer = setTimeout(() => proc.kill(), timeoutMs);

		try {
			const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

			return { code, stdout };
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Spawn the CLI in an empty directory, in its own process group, and read its reply. When `signal` aborts the
	 * group is killed and the call rejects at once, without waiting for its pipes to close; whatever the CLI
	 * started is killed with it once the call ends either way.
	 */
	private async run(
		path: string,
		args: string[],
		where: { cwd: string; env: Record<string, string> },
		signal: AbortSignal,
		onToken: ((text: string) => void) | undefined
	): Promise<string> {
		const proc = Bun.spawn([path, ...args], {
			cwd: where.cwd,
			env: where.env,
			detached: true,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe'
		});

		let abort = () => {};

		const stopped = new Promise<never>((_, reject) => {
			abort = () => {
				killGroup(proc);
				reject(cancelledError());
			};
		});

		stopped.catch(() => {});
		this.running.add(proc);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();

		try {
			const [text, stderr, code] = await Promise.race([
				Promise.all([this.readText(proc.stdout, onToken), new Response(proc.stderr).text(), proc.exited]),
				stopped
			]);

			if (code !== 0) throw devinError(lastLine(stderr) ?? lastLine(text) ?? `Devin exited with code ${code}.`);

			return text;
		} finally {
			signal.removeEventListener('abort', abort);
			this.running.delete(proc);
			killGroup(proc);
		}
	}

	private async readText(stream: ReadableStream<Uint8Array>, onToken: ((text: string) => void) | undefined) {
		const decoder = new TextDecoder();
		let text = '';

		for await (const chunk of stream) {
			const piece = decoder.decode(chunk, { stream: true });

			text += piece;
			if (piece) onToken?.(piece);
		}

		return text;
	}
}

export const devin = new DevinAgent();

stopOnShutdown('devin', () => devin.stop());
