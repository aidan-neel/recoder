import { lstat, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { git } from '../evidence/git.js';
import { MANIFESTS, packageDirs } from './install-inputs.js';
import type { SandboxLayout } from './sandbox-layout.js';

/** The `package.json` fields that decide what gets installed; a change to any other field keeps the same dependencies. */
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
	'overrides',
	'resolutions',
	'workspaces',
	'packageManager',
	'pnpm'
];

/** Installed-dependency folders the head checkout holds that the merge-base tree links to rather than reinstalls. */
const INSTALLED = ['node_modules', '.venv'];

/**
 * A copy of the merge-base commit for running a command where the change had
 * not happened yet. It lives in the review's cache folder, which the sandbox
 * already makes writable, so the head checkout is never touched: git reads the
 * head checkout's objects and writes only the new tree and its own index file.
 * Commands the sandbox runs can write the tree, so the index is kept beside
 * the cache folder, where they can't reach it, and git never writes to a tree
 * that was swapped for a link to somewhere else.
 * Installed dependencies are linked from the head checkout, which the
 * sandbox then sees read-only, and only when no manifest or lockfile changed.
 */
export class BaseTree {
	readonly root: string;
	private readonly index: string;
	private ready: Promise<string | null> | null = null;

	constructor(
		private readonly layout: SandboxLayout,
		private readonly headSha: string,
		private readonly baseSha: string
	) {
		this.root = join(layout.cacheDir, `base-${baseSha.slice(0, 12)}`);
		this.index = join(dirname(layout.cacheDir), `${basename(layout.cacheDir)}.base-${baseSha.slice(0, 12)}.index`);
	}

	/** The layout a command runs under to work in this tree, with the head checkout readable for the linked dependencies. */
	get sandbox(): SandboxLayout {
		return { ...this.layout, checkout: this.root, readOnly: [...(this.layout.readOnly ?? []), this.layout.checkout] };
	}

	/** Builds the tree once. Null when it is ready; otherwise why it can't be used. */
	prepare(signal?: AbortSignal): Promise<string | null> {
		this.ready ??= this.build(signal).catch((err) => `could not build the base tree: ${errorText(err)}`);

		return this.ready;
	}

	/** Puts back every file a command changed, so the next one starts from the commit. */
	async restore(signal?: AbortSignal): Promise<void> {
		if (!(await this.intact())) {
			this.ready = Promise.resolve('a command replaced the base tree');

			return;
		}

		const changed = await this.git(['diff-files', '--name-only', '-z'], signal);
		const paths = changed.stdout.split('\0').filter(Boolean);

		for (let at = 0; at < paths.length; at += 200)
			await this.git(['checkout-index', '-f', '-u', '--', ...paths.slice(at, at + 200)], signal);
	}

	/** Whether the tree is still a real folder, not a link a sandboxed command left in its place. */
	private async intact(): Promise<boolean> {
		return (await lstat(this.root).catch(() => null))?.isDirectory() ?? false;
	}

	/** Deletes the tree and its index. */
	async remove(): Promise<void> {
		await rm(this.root, { recursive: true, force: true });
		await rm(this.index, { force: true });
	}

	private async build(signal?: AbortSignal): Promise<string | null> {
		if (!this.baseSha || this.baseSha === this.headSha) return 'the change has no separate base commit';

		const manifests = MANIFESTS.map((name) => `:(glob)**/${name}`);

		const compared = await git(
			this.layout.checkout,
			['diff', '--name-only', '-z', this.baseSha, this.headSha, '--', ...manifests],
			signal
		);

		if (compared.code !== 0) return 'could not compare the dependency manifests';

		for (const path of compared.stdout.split('\0').filter(Boolean)) {
			if (!(await this.sameDependencies(path, signal))) return 'dependency manifests changed in this change';
		}

		await this.remove();
		await mkdir(this.root, { recursive: true });

		const loaded = await this.git(['read-tree', this.baseSha], signal);
		const written = loaded.code === 0 ? await this.git(['checkout-index', '-a', '-f', '-u', '-q'], signal) : loaded;

		if (written.code !== 0) return `could not check out the base commit: ${written.stderr.slice(0, 200).trim()}`;

		await this.linkInstalled(signal);

		return null;
	}

	/** Whether a changed manifest still installs the same things: only a `package.json` whose dependency fields all match. */
	private async sameDependencies(path: string, signal?: AbortSignal): Promise<boolean> {
		if (basename(path) !== 'package.json') return false;

		const [base, head] = await Promise.all(
			[this.baseSha, this.headSha].map((sha) => git(this.layout.checkout, ['show', `${sha}:${path}`], signal))
		);

		if (base.code !== 0 || head.code !== 0) return false;

		try {
			const fields = (text: string) => {
				const manifest = JSON.parse(text) as Record<string, unknown>;

				return JSON.stringify(DEPENDENCY_FIELDS.map((field) => manifest[field] ?? null));
			};

			return fields(base.stdout) === fields(head.stdout);
		} catch {
			return false;
		}
	}

	/** Runs git on the head checkout's objects with this tree as the work tree and its own index file. */
	private git(args: string[], signal?: AbortSignal) {
		return git(this.layout.checkout, [`--work-tree=${this.root}`, ...args], signal, { GIT_INDEX_FILE: this.index });
	}

	/** Links each package's installed folders from the head checkout, never over a path the base commit tracks. */
	private async linkInstalled(signal?: AbortSignal): Promise<void> {
		const listed = await git(this.layout.checkout, ['ls-tree', '-r', '--name-only', this.baseSha], signal);

		const dirs = packageDirs(listed.stdout);

		const base = await realpath(this.root);

		for (const dir of dirs) {
			for (const name of INSTALLED) await this.link(base, join(dir, name));
		}
	}

	/** Links `relative` in the tree to the same folder in the head checkout when that is a real folder and the path is free. */
	private async link(base: string, relative: string): Promise<void> {
		const from = join(this.layout.checkout, relative);
		const to = join(this.root, relative);

		if (!(await lstat(from).catch(() => null))?.isDirectory()) return;
		if (await lstat(to).catch(() => null)) return;

		const parent = await realpath(dirname(to)).catch(() => null);

		if (parent === null || !(parent === base || parent.startsWith(base + sep))) return;

		await symlink(from, to);
	}
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
