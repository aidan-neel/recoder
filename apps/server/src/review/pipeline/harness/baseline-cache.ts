import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckInputs } from '../../../sandbox/exec-workspace.js';
import { serverDataDir } from '../../../util/data-dir.js';

/** Bumped when what a stored result means changes, so older entries stop matching. */
const FORMAT = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Entries are dropped after this long unused, and the oldest go first when the total passes the size limit. */
const DEFAULT_LIMITS = { maxAgeMs: 14 * DAY_MS, maxBytes: 256 * 1024 * 1024 };

/** A baseline check as an earlier review finished it: its exit code and its whole recorded text. */
export interface CachedCheck {
	exitCode: number;
	content: string;
	elapsedMs: number;
}

export interface CacheLimits {
	maxAgeMs: number;
	maxBytes: number;
}

/** Off with `RECODER_BASELINE_CACHE=off`, for a suite suspected of flaking. */
export function baselineCacheEnabled(): boolean {
	return process.env.RECODER_BASELINE_CACHE !== 'off';
}

/** Under the server data dir, which the sandbox hides, so a sandboxed PR can neither read nor write results. */
export function baselineCacheDir(): string {
	return join(serverDataDir(), 'baseline-cache');
}

/**
 * Everything the result of `command` can depend on: the repo, the commit, the
 * package folder the command runs in, the command with its path filters, every
 * dependency input, and the tool versions. Any one differing is a different key.
 */
function cacheKey(inputs: CheckInputs, command: string): string {
	const folder = /^cd (\S+) && /.exec(command)?.[1] ?? '.';

	return createHash('sha256')
		.update(JSON.stringify([FORMAT, inputs.scope, inputs.headSha, folder, command, inputs.dependencies, inputs.tools]))
		.digest('hex');
}

function entryPath(inputs: CheckInputs, command: string): string {
	return join(baselineCacheDir(), inputs.scope.replace(/[^\w.-]/g, '_'), `${cacheKey(inputs, command)}.json`);
}

function isCachedCheck(value: unknown): value is CachedCheck {
	const entry = value as Partial<CachedCheck> | null;

	return (
		typeof entry?.exitCode === 'number' && typeof entry.content === 'string' && typeof entry.elapsedMs === 'number'
	);
}

/** The stored result of `command` for these inputs, marked as used just now; null when there is none or it cannot be read. */
export async function readCachedCheck(inputs: CheckInputs, command: string): Promise<CachedCheck | null> {
	const path = entryPath(inputs, command);

	try {
		const entry: unknown = JSON.parse(await readFile(path, 'utf8'));

		if (!isCachedCheck(entry)) return null;

		const now = new Date();

		await utimes(path, now, now).catch(() => undefined);

		return { exitCode: entry.exitCode, content: entry.content, elapsedMs: entry.elapsedMs };
	} catch {
		return null;
	}
}

/** Stores a finished result, then evicts. The file appears whole or not at all, so a reader never sees half of it. */
export async function writeCachedCheck(inputs: CheckInputs, command: string, entry: CachedCheck): Promise<void> {
	const path = entryPath(inputs, command);
	const temporary = `${path}.tmp-${randomUUID()}`;

	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(temporary, JSON.stringify(entry));
	await rename(temporary, path);
	await evictBaselineCache(baselineCacheDir(), DEFAULT_LIMITS);
}

interface Stored {
	path: string;
	bytes: number;
	usedAt: number;
}

async function storedEntries(root: string): Promise<Stored[]> {
	const scopes = await readdir(root, { withFileTypes: true }).catch(() => []);
	const entries: Stored[] = [];

	for (const scope of scopes.filter((item) => item.isDirectory())) {
		for (const name of await readdir(join(root, scope.name)).catch(() => [])) {
			const path = join(root, scope.name, name);
			const info = await stat(path).catch(() => null);

			if (info?.isFile() && name.endsWith('.json')) entries.push({ path, bytes: info.size, usedAt: info.mtimeMs });
		}
	}

	return entries;
}

/** Removes entries unused for longer than the age limit, then the least recently used until the total fits the size limit. */
export async function evictBaselineCache(root: string, limits: CacheLimits, now = Date.now()): Promise<void> {
	const entries = (await storedEntries(root)).sort((a, b) => a.usedAt - b.usedAt);
	let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);

	for (const entry of entries) {
		if (now - entry.usedAt <= limits.maxAgeMs && total <= limits.maxBytes) break;

		await rm(entry.path, { force: true });
		total -= entry.bytes;
	}
}
