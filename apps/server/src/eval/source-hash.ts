import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UNKNOWN } from './identity';

/** The repository root, from this module's place in it. */
const REPO_ROOT = resolve(import.meta.dir, '../../../..');

/** What a review runs: the server's and the shared package's sources, and the manifests that pin their dependencies. */
const SOURCES = [
	'apps/server/src/**',
	'packages/shared/src/**',
	'apps/server/package.json',
	'package.json',
	'bun.lock'
];

function sha256(data: Uint8Array | string): string {
	return createHash('sha256').update(data).digest('hex');
}

/** `source:<16 hex>` of one file's bytes; `unknown` when it cannot be read. */
export function fileVersion(path: string): string {
	try {
		return `source:${sha256(readFileSync(path)).slice(0, 16)}`;
	} catch {
		return UNKNOWN;
	}
}

/**
 * `source:<16 hex>` over every source file under `root`, by sorted relative
 * path and the SHA-256 of its bytes. It reads no git state, so the same files
 * hash alike in a clean checkout, a copy whose `.git` is behind, or a tree
 * with none; `unknown` when `root` holds none of them or one cannot be read.
 */
export function sourceVersion(root = REPO_ROOT): string {
	try {
		const paths = [
			...new Set(SOURCES.flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })]))
		].sort();

		if (!paths.length) return UNKNOWN;

		const manifest = paths.map((path) => `${path}\0${sha256(readFileSync(join(root, path)))}\n`).join('');

		return `source:${sha256(manifest).slice(0, 16)}`;
	} catch {
		return UNKNOWN;
	}
}
