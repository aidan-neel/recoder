import { readdir, readlink, readFile } from 'node:fs/promises';
import type { WebRestart } from '@recoder/shared';

/** A `next` command line, and which kind of server it is. `next-server` is the production server's own name. */
const NEXT_SERVER = /\bnext-server\b/;
const NEXT_DEV = /\bnext\b[^/]*\bdev\b/;
const NEXT_START = /\bnext\b[^/]*\bstart\b/;

interface WatchedProcess {
	cmdline: string;
	cwd: string | null;
}

/** Every process's command line and working directory, readable on Linux's /proc; null elsewhere. */
async function watchedProcesses(): Promise<WatchedProcess[] | null> {
	const pids = await readdir('/proc').catch(() => null);

	if (!pids) return null;

	const processes: WatchedProcess[] = [];

	for (const pid of pids) {
		if (!/^\d+$/.test(pid)) continue;

		const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => null);

		if (!raw) continue;

		processes.push({
			cmdline: raw.split('\0').filter(Boolean).join(' '),
			cwd: await readlink(`/proc/${pid}/cwd`).catch(() => null)
		});
	}

	return processes;
}

/**
 * Whether the checkout's web app picks an update up itself. A `next dev`
 * server hot-reloads; a `next start` build needs a rebuild and restart that
 * the update reports rather than performs — nothing supervises it that the
 * server knows of. No matching process means nothing to restart; a platform
 * without /proc answers 'unknown'.
 */
export async function detectWebRestart(root: string): Promise<WebRestart> {
	const processes = await watchedProcesses();

	if (processes === null) return 'unknown';

	let found = false;

	for (const { cmdline, cwd } of processes) {
		if (cwd === null || !cwd.startsWith(root)) continue;
		if (NEXT_DEV.test(cmdline)) return 'hot-reload';
		if (NEXT_START.test(cmdline) || NEXT_SERVER.test(cmdline)) found = true;
	}

	return found ? 'restart-required' : 'not-running';
}
