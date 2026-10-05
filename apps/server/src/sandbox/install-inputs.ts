import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

/**
 * Files that decide which dependencies get installed. The merge-base tree
 * borrows the head checkout's installed dependencies only when none of them
 * differ between the two commits; a `package.json` counts only by its
 * dependency fields.
 */
export const MANIFESTS = [
	'package.json',
	'bun.lock',
	'bun.lockb',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'yarn.lock',
	'.yarnrc.yml',
	'package-lock.json',
	'pyproject.toml',
	'requirements.txt',
	'uv.lock',
	'poetry.lock',
	'go.mod',
	'go.sum',
	'Cargo.toml',
	'Cargo.lock'
];

/** Folders never searched for packages. */
const VENDORED = /(?:^|\/)(?:node_modules|vendor|dist|build|fixtures?)\//;

/** Package folders linked at most, so a huge monorepo stays cheap. */
const MAX_PACKAGE_DIRS = 40;

/** Settings files that change what an install does without being manifests. */
const INSTALL_CONFIG = ['.npmrc', 'bunfig.toml', '.yarnrc.yml', '.yarnrc'];

/** Inputs whose code or contents the PR controls in a way a key cannot cover: a tracked `node_modules`, Yarn's own releases and plugins. */
const RUNS_CODE = /(?:^|\/)node_modules\/|(?:^|\/)\.yarn\/(?:plugins|releases)\//;

/** The folders holding a `package.json` in a `git ls-tree -r --name-only` listing, the root first and at most `MAX_PACKAGE_DIRS`. */
export function packageDirs(listing: string): string[] {
	return listing
		.split('\n')
		.filter((path) => /(^|\/)package\.json$/.test(path) && !VENDORED.test(path))
		.map((path) => dirname(path))
		.concat('.')
		.filter((dir, at, all) => all.indexOf(dir) === at)
		.sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : 0))
		.slice(0, MAX_PACKAGE_DIRS);
}

interface TreeEntry {
	path: string;
	blob: string;
}

/** The entries of `git ls-tree -r -z`: `<mode> <type> <sha>\t<path>` separated by NUL. */
function parseTree(text: string): TreeEntry[] {
	return text
		.split('\0')
		.filter(Boolean)
		.map((record) => {
			const tab = record.indexOf('\t');

			return { path: record.slice(tab + 1), blob: record.slice(0, tab).split(' ')[2] ?? '' };
		});
}

function isInput({ path }: TreeEntry): boolean {
	if (VENDORED.test(path)) return false;

	return MANIFESTS.includes(basename(path)) || INSTALL_CONFIG.includes(basename(path)) || path.startsWith('patches/');
}

export type GitText = (args: string[]) => Promise<{ code: number; stdout: string }>;

/**
 * A key for everything an install reads at `sha`: manifests, lockfiles,
 * settings files and patches, each by content, plus the install command. Two
 * checkouts with the same key install the same dependencies. Null when the
 * install would run code the key cannot cover (a Yarn release or plugin, a
 * tracked `node_modules`), when the commit cannot be listed, or when there is
 * no lockfile, because an install that resolves versions is not repeatable.
 */
export async function installKey(
	git: GitText,
	sha: string,
	command: string,
	lockfiles: string[]
): Promise<string | null> {
	const listed = await git(['ls-tree', '-r', '-z', sha]);

	if (listed.code !== 0) return null;

	const entries = parseTree(listed.stdout);

	if (entries.some((entry) => RUNS_CODE.test(entry.path))) return null;
	if (!entries.some((entry) => lockfiles.includes(entry.path))) return null;

	for (const entry of entries.filter((item) => basename(item.path) === '.yarnrc.yml')) {
		const shown = await git(['cat-file', 'blob', entry.blob]);

		if (shown.code !== 0 || /yarnPath|plugins/.test(shown.stdout)) return null;
	}

	const hash = createHash('sha256').update(`${command}\0`);

	for (const entry of entries.filter(isInput).sort((a, b) => (a.path < b.path ? -1 : 1))) {
		hash.update(`${entry.path}\0${entry.blob}\0`);
	}

	return hash.digest('hex').slice(0, 32);
}
