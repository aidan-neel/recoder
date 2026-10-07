import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HostConfig } from '$lib/reports/types';
import { SSH_OPTIONS } from './hosts';

/** Remote reports are copied here and read like local ones. Nothing is ever written back. */
const CACHE = join(homedir(), '.recoder', 'bench-cache');

/** A sync younger than this is reused, so many page loads cost one rsync. */
const FRESH_MS = 15_000;

const synced = new Map<string, { at: number; pending: Promise<void> }>();

/** The directory holding the host's benchmark reports and run logs. */
export function evalsDir(target: HostConfig): string {
	return target.ssh ? join(CACHE, target.id, 'evals') : join(target.dataDir, 'evals');
}

/** The directory holding the host's datasets (only their labels, for a remote host). */
export function datasetsDir(target: HostConfig): string {
	return target.ssh ? join(CACHE, target.id, 'datasets') : target.datasetsDir;
}

function rsync(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('rsync', ['-az', '-e', ['ssh', ...SSH_OPTIONS].join(' '), ...args], { timeout: 120_000 }, (error) =>
			error ? reject(error) : resolve()
		);
	});
}

async function pull(target: HostConfig): Promise<void> {
	const evals = evalsDir(target);
	const datasets = datasetsDir(target);

	mkdirSync(evals, { recursive: true });
	mkdirSync(datasets, { recursive: true });

	await Promise.all([
		rsync([
			'--include=benchmark-*.json',
			'--include=*.log',
			'--exclude=server.log',
			'--exclude=*',
			`${target.ssh}:${target.dataDir}/evals/`,
			`${evals}/`
		]),
		rsync([
			'--prune-empty-dirs',
			'--include=*/',
			'--include=*/labels/*.json',
			'--exclude=*',
			`${target.ssh}:${target.datasetsDir}/`,
			`${datasets}/`
		])
	]);
}

/**
 * Copies a remote host's reports, run logs and dataset labels into the local
 * cache when the last copy is older than a few seconds; `force` copies now.
 * A failed copy keeps what the cache already has.
 */
export async function syncHost(target: HostConfig, force = false): Promise<void> {
	if (!target.ssh) return;

	const last = synced.get(target.id);

	if (last && Date.now() - last.at < (force ? 2_000 : FRESH_MS)) return last.pending;

	const pending = pull(target).catch(() => undefined);

	synced.set(target.id, { at: Date.now(), pending });

	return pending;
}
