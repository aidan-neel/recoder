import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HostConfig } from '$lib/reports/types';
import { host, SSH_OPTIONS } from './hosts';
import { swr } from './swr';

/** Remote reports are copied here and read like local ones. Nothing is ever written back. */
const CACHE = join(homedir(), '.recoder', 'bench-cache');

/** A sync younger than this is reused, so many page loads cost one rsync. */
const FRESH_MS = 15_000;

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

/** One copy per host at a time; a failed copy keeps what the cache already has. */
const copies = swr<void>(FRESH_MS, (id) => pull(host(id)).catch(() => undefined));

function hasCopy(target: HostConfig): boolean {
	const dir = evalsDir(target);

	return existsSync(dir) && readdirSync(dir).length > 0;
}

/**
 * Copies a remote host's reports, run logs and dataset labels into the local
 * cache when the last copy is older than a few seconds. Once the cache holds
 * a copy, even one from an earlier start of this app, callers read it at once
 * and the copy runs in the background.
 */
export async function syncHost(target: HostConfig): Promise<void> {
	if (!target.ssh) return;

	const copy = copies.read(target.id);

	if (!hasCopy(target)) await copy;
}
