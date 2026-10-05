import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { copyTree } from './overlay.js';

/**
 * Dependency installs and package stores that reviews of one repo share. The
 * sandbox never sees these directories: a review gets them as the read-only
 * layer of an overlay (or as its own copy), so a write by PR code lands in the
 * review's private layer and never here.
 *
 * `installs/<scope>/<key>/` holds `tree/` (the installed folders, laid out as
 * in the checkout) and `ready.json`, whose mtime is when a review last used it.
 * `stores/<scope>/` holds numbered store versions and `current`, a link to the
 * newest. A version is never changed after it is published.
 */

const DAY = 24 * 60 * 60 * 1000;

interface InstallLimits {
	maxAgeMs: number;
	maxBytes: number;
}

const LIMITS: InstallLimits = { maxAgeMs: 14 * DAY, maxBytes: 30 * 1024 ** 3 };

export interface SharedInstall {
	dir: string;
	/** Installed folders relative to the checkout, such as `node_modules` and `packages/a/node_modules`. */
	dirs: string[];
}

const holds = new Map<string, number>();
const builds = new Map<string, Promise<void>>();

/** Marks a directory as in use by a running review so eviction leaves it alone; call the result to let go. */
export function holdSharedInstall(dir: string): () => void {
	holds.set(dir, (holds.get(dir) ?? 0) + 1);

	let released = false;

	return () => {
		if (released) return;
		released = true;

		const left = (holds.get(dir) ?? 1) - 1;

		if (left > 0) holds.set(dir, left);
		else holds.delete(dir);
	};
}

/**
 * The repo a checkout belongs to, from its folder name (`owner__repo__pr-7__id`).
 * Reviews of one repo share installs only under the same scope.
 */
export function scopeOfCheckout(checkout: string): string | null {
	const at = basename(checkout).indexOf('__pr-');

	return at > 0 ? basename(checkout).slice(0, at) : null;
}

/** The published install for `key`, marked as used just now; null when there is none. */
export async function findInstall(sharedDir: string, scope: string, key: string): Promise<SharedInstall | null> {
	const dir = join(sharedDir, 'installs', scope, key);

	try {
		const ready = JSON.parse(await readFile(join(dir, 'ready.json'), 'utf8')) as { dirs: string[] };
		const now = new Date();

		await utimes(join(dir, 'ready.json'), now, now);

		return { dir, dirs: ready.dirs };
	} catch {
		return null;
	}
}

/**
 * Claims the right to build the install for `id`. Resolves to a release
 * function once it is yours; resolves to null after waiting for another review
 * that was already building it, so the caller looks again before building.
 */
export async function claimBuild(id: string): Promise<(() => void) | null> {
	const running = builds.get(id);

	if (running) {
		await running;

		return null;
	}

	let finish = () => {};

	builds.set(
		id,
		new Promise<void>((resolve) => {
			finish = resolve;
		})
	);

	return () => {
		builds.delete(id);
		finish();
	};
}

/** Disk blocks a directory uses, in bytes; 0 when it cannot be measured. */
async function diskBytes(dir: string): Promise<number> {
	const proc = Bun.spawn(['du', '-sk', dir], { stdout: 'pipe', stderr: 'ignore' });
	const text = await new Response(proc.stdout).text();

	await proc.exited;

	return (Number(text.split('\t')[0]) || 0) * 1024;
}

/**
 * Publishes the checkout's installed folders as the install for `key`. With
 * `move` the folders leave the checkout (the caller mounts them back as
 * overlays); without it they are copied. The tree is built beside the final
 * place and renamed into it, so no review ever sees half an install. Null when
 * it could not be published; the checkout is left as it was.
 */
export async function publishInstall(opts: {
	sharedDir: string;
	scope: string;
	key: string;
	checkout: string;
	dirs: string[];
	move: boolean;
}): Promise<SharedInstall | null> {
	const final = join(opts.sharedDir, 'installs', opts.scope, opts.key);
	const building = `${final}.tmp-${randomUUID().slice(0, 8)}`;
	const moved: string[] = [];

	try {
		for (const rel of opts.dirs) {
			await mkdir(dirname(join(building, 'tree', rel)), { recursive: true });

			if (opts.move) {
				await rename(join(opts.checkout, rel), join(building, 'tree', rel));
				moved.push(rel);
			} else {
				await copyTree(join(opts.checkout, rel), join(building, 'tree', rel));
			}
		}

		const bytes = await diskBytes(join(building, 'tree'));

		await writeFile(join(building, 'ready.json'), JSON.stringify({ dirs: opts.dirs, bytes }));
		await rename(building, final);
	} catch {
		for (const rel of moved.reverse())
			await rename(join(building, 'tree', rel), join(opts.checkout, rel)).catch(() => {});
		await rm(building, { recursive: true, force: true });
	}

	const published = await findInstall(opts.sharedDir, opts.scope, opts.key);

	if (published) void evictSharedInstalls(opts.sharedDir, LIMITS).catch(() => {});

	return published;
}

/** The newest store of a repo, held for a running review; null when the repo has none. */
export async function holdCurrentStore(
	sharedDir: string,
	scope: string
): Promise<{ dir: string; release: () => void } | null> {
	const root = join(sharedDir, 'stores', scope);

	try {
		const dir = await realpath(join(root, 'current'));
		const now = new Date();

		await utimes(join(root, '.used'), now, now).catch(() => {});

		return { dir, release: holdSharedInstall(dir) };
	} catch {
		return null;
	}
}

/** Moves every file a review wrote into the new store version and drops what it deleted. */
async function mergeUpper(upper: string, into: string): Promise<void> {
	for (const entry of await readdir(upper, { withFileTypes: true })) {
		const from = join(upper, entry.name);
		const to = join(into, entry.name);

		if (entry.isDirectory()) {
			await mkdir(to, { recursive: true });
			await mergeUpper(from, to);
		} else if (entry.isCharacterDevice()) {
			await rm(to, { recursive: true, force: true });
		} else {
			await rm(to, { recursive: true, force: true });
			await rename(from, to);
		}
	}
}

/** `cp -al`: a copy of a store whose files are links to the old ones, so it costs no space. */
async function linkCopy(from: string, to: string): Promise<void> {
	const proc = Bun.spawn(['cp', '-al', from, to], { stdout: 'ignore', stderr: 'pipe' });
	const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

	if (code !== 0) throw new Error(stderr.trim().slice(0, 200));
}

/**
 * Makes what a trusted install wrote the newest store version. `layer` is
 * either only what the install added on top of `current` (`overlaid`, merged
 * into a link copy of it) or the review's whole private store, which is copied.
 * Returns the new version, held for the review; null when it could not be
 * published.
 */
export async function publishStore(opts: {
	sharedDir: string;
	scope: string;
	current: string | null;
	layer: string;
	overlaid: boolean;
}): Promise<{ dir: string; release: () => void } | null> {
	const root = join(opts.sharedDir, 'stores', opts.scope);
	const version = join(root, `v-${randomUUID().slice(0, 8)}`);

	try {
		await mkdir(root, { recursive: true });

		if (opts.overlaid && opts.current) {
			await linkCopy(opts.current, version);
			await mergeUpper(opts.layer, version);
		} else {
			await copyTree(opts.layer, version);
		}

		await symlink(basename(version), join(root, 'current.tmp'));
		await rename(join(root, 'current.tmp'), join(root, 'current'));
		await writeFile(join(root, '.used'), '');
	} catch {
		await rm(join(root, 'current.tmp'), { force: true });
		await rm(version, { recursive: true, force: true });

		return null;
	}

	const release = holdSharedInstall(version);

	void dropOldStores(root, version).catch(() => {});

	return { dir: version, release };
}

/** Removes store versions older than the newest that no review holds. */
async function dropOldStores(root: string, newest: string): Promise<void> {
	for (const name of await readdir(root)) {
		const dir = join(root, name);

		if (name.startsWith('v-') && dir !== newest && !holds.has(dir)) await rm(dir, { recursive: true, force: true });
	}
}

interface Aged {
	dir: string;
	used: number;
	bytes: number;
}

/** Published installs with their last use and size; installs still being built are not listed. */
async function listInstalls(sharedDir: string): Promise<Aged[]> {
	const root = join(sharedDir, 'installs');
	const found: Aged[] = [];

	for (const scope of await readdir(root).catch(() => [])) {
		for (const key of (await readdir(join(root, scope)).catch(() => [])).filter((name) => !name.includes('.tmp-'))) {
			const dir = join(root, scope, key);
			const ready = join(dir, 'ready.json');

			try {
				const { bytes } = JSON.parse(await readFile(ready, 'utf8')) as { bytes: number };

				found.push({ dir, used: (await stat(ready)).mtimeMs, bytes });
			} catch {}
		}
	}

	return found;
}

/**
 * Removes installs unused for longer than the age limit, then the least
 * recently used until the rest fit the size limit, and the stores of repos
 * nobody has reviewed for the age limit. What a review holds stays. The marker
 * goes first so a lookup never finds half an install.
 */
export async function evictSharedInstalls(sharedDir: string, limits: InstallLimits, now = Date.now()): Promise<void> {
	const installs = (await listInstalls(sharedDir)).sort((a, b) => a.used - b.used);
	let total = installs.reduce((sum, install) => sum + install.bytes, 0);

	for (const install of installs) {
		const old = now - install.used > limits.maxAgeMs;

		if (holds.has(install.dir) || (!old && total <= limits.maxBytes)) continue;

		total -= install.bytes;
		await rm(join(install.dir, 'ready.json'), { force: true });
		await rm(install.dir, { recursive: true, force: true });
	}

	const stores = join(sharedDir, 'stores');

	for (const scope of await readdir(stores).catch(() => [])) {
		const root = join(stores, scope);
		const used = await stat(join(root, '.used')).catch(() => null);
		const inUse = [...holds.keys()].some((dir) => dir.startsWith(root + '/'));

		if (used && !inUse && now - used.mtimeMs > limits.maxAgeMs && existsSync(root)) {
			await rm(root, { recursive: true, force: true });
		}
	}
}
