import { mkdir } from 'node:fs/promises';
import type { CommandRun } from '@recoder/shared';
import { env } from '../env';
import { allowedCommands } from '../env';
import { db } from '../store';

export interface RunOptions {
	command: string;
	args?: string[];
	/** Human label shown in the dashboard (e.g. "collect diff"). */
	label?: string;
	cwd?: string;
	timeoutMs?: number;
	/** Extra env vars merged over process.env for this run only. */
	env?: Record<string, string>;
	onOutput?: (chunk: string) => void;
}

const MAX_LOG_CHARS = 200_000;

/** process.env minus undefined values, merged with overrides (Bun needs Record<string, string>). */
function withEnv(overrides: Record<string, string>): Record<string, string> {
	const base: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) base[key] = value;
	}
	return { ...base, ...overrides };
}

function truncate(logs: string): string {
	if (logs.length <= MAX_LOG_CHARS) return logs;
	return `…[truncated ${logs.length - MAX_LOG_CHARS} chars]\n` + logs.slice(-MAX_LOG_CHARS);
}

/**
 * Execute an allowlisted binary via Bun.spawn (argv array, never a shell),
 * capture stdout/stderr, enforce a timeout, and persist a CommandRun.
 */
export async function runCommand(opts: RunOptions): Promise<CommandRun> {
	const args = opts.args ?? [];
	const run: CommandRun = {
		id: crypto.randomUUID(),
		label: opts.label ?? null,
		command: opts.command,
		args,
		status: 'running',
		exitCode: null,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		logs: ''
	};

	if (!allowedCommands.has(opts.command)) {
		run.status = 'rejected';
		run.finishedAt = new Date().toISOString();
		run.logs = `command "${opts.command}" is not allowlisted (RECODER_ALLOWED_COMMANDS=${env.RECODER_ALLOWED_COMMANDS})`;
		db.runs.set(run);
		throw new Error(run.logs);
	}

	const cwd = opts.cwd ?? env.RECODER_WORKDIR;
	const timeoutMs = opts.timeoutMs ?? env.RECODER_COMMAND_TIMEOUT_MS;
	await mkdir(cwd, { recursive: true });

	db.runs.set(run);

	try {
		const proc = Bun.spawn([opts.command, ...args], {
			cwd,
			stdout: 'pipe',
			stderr: 'pipe',
			env: opts.env ? withEnv(opts.env) : undefined
		});

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, timeoutMs);

		const read = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
			if (!stream) return '';
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			let text = '';
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const chunk = decoder.decode(value, { stream: true });
					text += chunk;
					try { opts.onOutput?.(chunk); } catch { /* Reporting cannot break a command. */ }
				}
				return text + decoder.decode();
			} finally { reader.releaseLock(); }
		};
		const [stdout, stderr, exitCode] = await Promise.all([
			read(proc.stdout),
			read(proc.stderr),
			proc.exited
		]);
		clearTimeout(timer);

		const combined = [stdout, stderr ? `\n[stderr]\n${stderr}` : ''].join('').trim();
		run.logs = truncate(combined);
		run.exitCode = exitCode;
		run.status = timedOut ? 'killed' : exitCode === 0 ? 'succeeded' : 'failed';
		run.finishedAt = new Date().toISOString();
		db.runs.set(run);
		return run;
	} catch (err) {
		run.status = 'failed';
		run.finishedAt = new Date().toISOString();
		run.logs = truncate(err instanceof Error ? err.message : String(err));
		db.runs.set(run);
		throw err;
	}
}
