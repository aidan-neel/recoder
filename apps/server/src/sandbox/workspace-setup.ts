import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult, SandboxLayout } from './exec-sandbox.js';
import { installKey, packageDirs, type GitText } from './install-inputs.js';
import { copyTree, mountable, overlayUnavailableReason, removeOverlayDirs, type OverlayMount } from './overlay.js';
import {
	claimBuild,
	findInstall,
	holdCurrentStore,
	holdSharedInstall,
	publishInstall,
	publishStore,
	type SharedInstall
} from './shared-install.js';

export interface SetupStep {
	/** Why this step was picked, e.g. `bun.lock`. */
	marker: string;
	command: string;
}

export interface SetupReport {
	steps: Array<
		SetupStep & {
			exitCode: number | null;
			output: string;
			elapsedMs: number;
			/** The dependencies came from the shared install of an earlier review; nothing was installed. */
			reused?: boolean;
		}
	>;
	/** Lockfiles found whose tool isn't installed on this machine. */
	missing: string[];
}

interface Marker {
	files: string[];
	tool: string;
	command: string;
}

/** First match per ecosystem wins; lifecycle scripts stay off because they run PR code with network access. */
const SETUP_MARKERS: Marker[][] = [
	[
		{ files: ['bun.lock', 'bun.lockb'], tool: 'bun', command: 'bun install --frozen-lockfile --ignore-scripts' },
		{
			files: ['pnpm-lock.yaml'],
			tool: 'pnpm',
			command: 'pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile'
		},
		{ files: ['.yarnrc.yml'], tool: 'yarn', command: 'yarn install --immutable --mode=skip-build' },
		{ files: ['yarn.lock'], tool: 'yarn', command: 'yarn install --frozen-lockfile --ignore-scripts' },
		{ files: ['package-lock.json'], tool: 'npm', command: 'npm ci --ignore-scripts --no-audit --no-fund' },
		{ files: ['package.json'], tool: 'npm', command: 'npm install --ignore-scripts --no-audit --no-fund' }
	],
	[
		{ files: ['uv.lock'], tool: 'uv', command: 'uv sync --frozen --no-install-project' },
		{ files: ['poetry.lock'], tool: 'poetry', command: 'poetry install --no-root --no-interaction' },
		{
			files: ['requirements.txt'],
			tool: 'python3',
			command: 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt'
		}
	],
	[{ files: ['go.mod'], tool: 'go', command: 'go mod download' }],
	[{ files: ['Cargo.toml'], tool: 'cargo', command: 'cargo fetch' }]
];

/** The steps whose installed folders reviews of one repo share: the JavaScript installs. */
const SHARED_COMMANDS = new Set(SETUP_MARKERS[0]!.map((marker) => marker.command));

/** Root lockfiles of those installs; without one the install is not repeatable, so it is not shared. */
export const JS_LOCKFILES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];

/** Install steps for the repo root's lockfiles; tools missing from PATH are reported, not run. */
export function setupPlan(
	rootFiles: Set<string>,
	has: (tool: string) => boolean
): { steps: SetupStep[]; missing: string[] } {
	const steps: SetupStep[] = [];
	const missing: string[] = [];

	for (const ecosystem of SETUP_MARKERS) {
		for (const marker of ecosystem) {
			const file = marker.files.find((name) => rootFiles.has(name));

			if (!file) continue;
			if (has(marker.tool)) steps.push({ marker: file, command: marker.command });
			else missing.push(`${file} (needs ${marker.tool})`);
			break;
		}
	}

	return { steps, missing };
}

/** What setup needs from the workspace that runs it. */
export interface SetupHost {
	layout: SandboxLayout;
	headSha: string;
	/** Present when reviews of this repo may share installs; `baseSha` is the merge base. */
	share?: { scope: string; baseSha: string };
	git: GitText;
	/** Runs an install command in the sandbox with network, one command at a time. */
	install: (command: string) => Promise<RunResult>;
}

/**
 * One install step's place in the shared state: the key of its inputs, and
 * whether the pull request left them as they were at the merge base. Only a
 * trusted install may add to the shared package store.
 */
interface SharePlan {
	scope: string;
	key: string;
	trusted: boolean;
}

/** The dependencies of a step, shared when its inputs can be keyed; null when the step installs on its own. */
async function sharePlan(host: SetupHost, command: string): Promise<SharePlan | null> {
	if (!host.share || !SHARED_COMMANDS.has(command)) return null;

	const key = await installKey(host.git, host.headSha, command, JS_LOCKFILES);

	if (!key) return null;

	const base = await installKey(host.git, host.share.baseSha, command, JS_LOCKFILES);

	return { scope: host.share.scope, key, trusted: base === key };
}

const REUSED: RunResult = {
	exitCode: 0,
	output: 'Reused the shared install from an earlier review.',
	truncated: false,
	timedOut: false,
	elapsedMs: 0
};

/**
 * How one review gets shared directories: as overlays on Linux, where
 * overlayfs works for an unprivileged user, and as private copies elsewhere
 * (APFS clones on macOS). Either way PR code can only change its own copy.
 */
class SharedMounts {
	private installs: OverlayMount[] = [];
	private store: OverlayMount | null = null;
	readonly leases: Array<() => void> = [];

	private constructor(
		private readonly host: SetupHost,
		private readonly checkout: string,
		readonly overlay: boolean
	) {}

	/** Overlays when the host mounts them and every path can go into the mount options; copies otherwise. */
	static async open(host: SetupHost, checkout: string): Promise<SharedMounts> {
		const { layout } = host;

		const paths = mountable({
			lower: layout.sharedDir,
			upper: layout.layersDir,
			work: layout.cacheDir,
			target: checkout
		});

		return new SharedMounts(host, checkout, paths && (await overlayUnavailableReason()) === null);
	}

	private get storeDir(): string {
		return join(this.host.layout.cacheDir, 'store');
	}

	private apply(): void {
		this.host.layout.overlays = [...this.installs, ...(this.store ? [this.store] : [])];
	}

	private mount(lower: string, name: string, target: string): OverlayMount {
		const { layersDir } = this.host.layout;

		return { lower, upper: join(layersDir, `${name}.up`), work: join(layersDir, `${name}.wk`), target };
	}

	/** Puts the repo's newest package store where the install tools look for it. Returns what it was, for merging back. */
	async attachStore(): Promise<string | null> {
		const { sharedDir } = this.host.layout;
		const held = await holdCurrentStore(sharedDir, this.host.share!.scope);

		if (!held) return null;

		this.leases.push(held.release);

		if (this.overlay) {
			this.store = this.mount(held.dir, 'store', this.storeDir);
			this.apply();
		} else {
			await rm(this.storeDir, { recursive: true, force: true });
			await copyTree(held.dir, this.storeDir);
		}

		return held.dir;
	}

	/** Makes what a trusted install wrote the repo's newest package store, and uses it from now on. */
	async publishStore(current: string | null): Promise<void> {
		const { layout, share } = { layout: this.host.layout, share: this.host.share! };
		const overlaid = this.overlay && this.store !== null;
		const layer = overlaid ? this.store!.upper : this.storeDir;
		const published = await publishStore({ sharedDir: layout.sharedDir, scope: share.scope, current, layer, overlaid });

		if (!published) return;

		this.leases.push(published.release);

		if (!this.overlay) return;

		await rm(this.storeDir, { recursive: true, force: true });
		await removeOverlayDirs(join(layout.layersDir, 'store.up'));
		await removeOverlayDirs(join(layout.layersDir, 'store.wk'));

		this.store = this.mount(published.dir, 'store', this.storeDir);
		this.apply();
	}

	/** Shows a published install in the checkout. */
	async attachInstall(install: SharedInstall): Promise<void> {
		this.leases.push(holdSharedInstall(install.dir));

		for (const rel of install.dirs) {
			const lower = join(install.dir, 'tree', rel);
			const target = join(this.checkout, rel);

			if (this.overlay) {
				this.installs.push(this.mount(lower, `install/${rel}`, target));
			} else {
				await rm(target, { recursive: true, force: true });
				await copyTree(lower, target);
			}
		}

		this.apply();
	}

	/** After a publish: with overlays the folders moved out and the published copy is mounted over their place; with copies the checkout keeps its own. */
	async afterPublish(install: SharedInstall): Promise<void> {
		if (this.overlay) await this.attachInstall(install);
		else this.leases.push(holdSharedInstall(install.dir));
	}
}

/** The `node_modules` folders an install left in the checkout, as paths relative to it. */
async function installedDirs(host: SetupHost, checkout: string): Promise<string[]> {
	const listed = await host.git(['ls-tree', '-r', '--name-only', host.headSha]);
	const found: string[] = [];

	for (const dir of packageDirs(listed.stdout)) {
		const rel = dir === '.' ? 'node_modules' : join(dir, 'node_modules');

		if ((await lstat(join(checkout, rel)).catch(() => null))?.isDirectory()) found.push(rel);
	}

	return found;
}

/**
 * Runs one install step, sharing it with other reviews of the repo when it can
 * be keyed. A review whose key has an install published uses that and skips the
 * command. Otherwise it installs, and a successful install is published for the
 * next review. Reviews that start together wait for the first instead of
 * installing twice.
 */
async function runShared(
	host: SetupHost,
	checkout: string,
	step: SetupStep,
	plan: SharePlan,
	mounts: SharedMounts
): Promise<{ result: RunResult; reused: boolean }> {
	const { sharedDir } = host.layout;
	const id = `${plan.scope}/${plan.key}`;

	for (let attempt = 0; attempt < 3; attempt++) {
		const found = await findInstall(sharedDir, plan.scope, plan.key);

		if (found) {
			await mounts.attachStore();
			await mounts.attachInstall(found);

			return { result: REUSED, reused: true };
		}

		const done = await claimBuild(id);

		if (!done) continue;

		try {
			const current = await mounts.attachStore();
			const result = await host.install(step.command);

			if (result.exitCode === 0) {
				await publishAfterInstall(host, checkout, plan, mounts, current);
			}

			return { result, reused: false };
		} finally {
			done();
		}
	}

	return { result: await host.install(step.command), reused: false };
}

/** Publishes the folders and, for a trusted install, the package store an install just filled. */
async function publishAfterInstall(
	host: SetupHost,
	checkout: string,
	plan: SharePlan,
	mounts: SharedMounts,
	current: string | null
): Promise<void> {
	const dirs = await installedDirs(host, checkout);

	if (!dirs.length) return;

	const published = await publishInstall({
		sharedDir: host.layout.sharedDir,
		scope: plan.scope,
		key: plan.key,
		checkout,
		dirs,
		move: mounts.overlay
	});

	if (published) await mounts.afterPublish(published);
	if (published && plan.trusted) await mounts.publishStore(current);
}

/**
 * Installs dependencies for each step of the plan. Returns the report and a
 * function that lets go of the shared directories this review holds.
 */
export async function runSetup(
	host: SetupHost,
	checkout: string,
	steps: SetupStep[],
	onStep: ((step: SetupStep, result: RunResult | null) => void) | undefined,
	signal: AbortSignal | undefined
): Promise<{ steps: SetupReport['steps']; release: () => void }> {
	const mounts = host.share ? await SharedMounts.open(host, checkout) : null;
	const report: SetupReport['steps'] = [];

	for (const step of steps) {
		if (signal?.aborted) break;
		onStep?.(step, null);

		const plan = mounts ? await sharePlan(host, step.command) : null;

		const { result, reused } = plan
			? await runShared(host, checkout, step, plan, mounts!)
			: { result: await host.install(step.command), reused: false };

		onStep?.(step, result);

		report.push({
			...step,
			exitCode: result.exitCode,
			output: result.output,
			elapsedMs: result.elapsedMs,
			...(reused ? { reused } : {})
		});
	}

	return {
		steps: report,
		release: () => {
			for (const release of mounts?.leases.splice(0) ?? []) release();
		}
	};
}

/** Removes a review's private overlay layers. */
export async function removeLayers(layout: SandboxLayout): Promise<void> {
	await removeOverlayDirs(layout.layersDir);
}
