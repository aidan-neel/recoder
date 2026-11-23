import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { AddedLines } from './changed-lines.js';

const TS_FILE = /\.(ts|tsx|mts|cts)$/;

/** True when the real path of `path` lies inside `root`, so a symlink in the checkout cannot read the host. */
export function insideTypeHintRoot(root: string, path: string): boolean {
	try {
		const real = relative(realpathSync(root), realpathSync(path));

		return !real.startsWith('..') && !real.startsWith('/');
	} catch {
		return false;
	}
}

/** The nearest tsconfig above a file, within the checkout. */
function nearestConfig(root: string, file: string): string | null {
	let dir = dirname(join(root, file));

	while (dir.startsWith(root)) {
		const candidate = join(dir, 'tsconfig.json');

		if (existsSync(candidate) && insideTypeHintRoot(root, candidate)) return candidate;

		const parent = dirname(dir);

		if (parent === dir) break;

		dir = parent;
	}

	return null;
}

/** Selects projects without initializing the compiler for a checkout that has no applicable tsconfig. */
export function typeHintProjects(root: string, added: AddedLines): Map<string, string[]> {
	const real = resolve(root);
	const byConfig = new Map<string, string[]>();

	for (const file of added.keys()) {
		if (!TS_FILE.test(file) || /\.d\.ts$/.test(file)) continue;

		const config = nearestConfig(real, file);

		if (config) byConfig.set(config, [...(byConfig.get(config) ?? []), file]);
	}

	return byConfig;
}
