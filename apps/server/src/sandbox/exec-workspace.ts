import { reviewNow } from '../review/session/review-control.js';
import { REVIEW_POLICY } from '../review/session/review-policy.js';
import { runSandboxed, sandboxLayout, type RunResult, type SandboxLayout } from './exec-sandbox.js';
import { sanitizeRepoPath } from '../evidence/evidence.js';
import { BaseTree } from './base-tree.js';
import { installKey } from './install-inputs.js';
import {
	JS_LOCKFILES,
	removeLayers,
	runSetup,
	setupPlan,
	type SetupReport,
	type SetupStep
} from './workspace-setup.js';

/**
 * One review's execution environment: the PR checkout inside bubblewrap.
 * Commands run one at a time (agents share the checkout), start only after
 * dependency setup finishes, and never outlive the review deadline. Tracked
 * files are restored after each command so one agent's edits never leak into
 * another's evidence. Scratch files belong to the agent that wrote them: they
 * are on disk only while that agent's own command runs, so no other agent's
 * run, test glob or verdict can pick them up.
 */

/** Interpreters a reviewer might reach for to run a repro, in the order they are listed. */
const RUNTIMES = ['bun', 'node', 'deno', 'python3'];

/** Prints each tool a check may run with and the version the checkout would use, one per line. */
const TOOL_VERSIONS =
	'for tool in bun node deno python3 pnpm yarn npm; do if command -v $tool >/dev/null 2>&1; then echo "$tool $($tool --version 2>&1 | head -n 1)"; fi; done';

/** What a check's result depends on besides the commit's files, as far as the sandbox can tell; the cache key is built from it. */
export interface CheckInputs {
	/** The repo, as reviews of it share installs. */
	scope: string;
	headSha: string;
	/** A digest of every manifest, lockfile, install setting and patch at the commit, plus the install command. */
	dependencies: string;
	/** The version of every tool on the sandbox PATH, plus the host's platform. */
	tools: string;
}

/** Hears when one owner's calls join the command queue, start running and end. */
export interface QueueWatcher {
	queued(): void;
	started(): void;
	finished(): void;
}

export class ExecWorkspace {
	readonly layout: SandboxLayout;
	/** Runs past this moment are cut short; set by the harness. */
	deadlineAt = Number.POSITIVE_INFINITY;
	private queue: Promise<unknown> = Promise.resolve();
	/** Who hears about each owner's queued calls; see `watchQueue`. */
	private readonly watchers = new Map<string, QueueWatcher>();
	private setupDone: Promise<SetupReport> | null = null;
	/** Each agent's scratch files, path → content, placed only around that agent's runs. */
	private readonly scratch = new Map<string, Map<string, string>>();
	/** The merge-base copy, built the first time a command runs on it. */
	private baseTree: BaseTree | null = null;
	/** Lets go of the shared installs and stores this review holds. */
	private releaseShared: () => void = () => {};

	constructor(
		readonly checkout: string,
		readonly headSha: string,
		layout?: SandboxLayout,
		/** Lets reviews of one repo share installs: the repo's scope and the merge base. */
		private readonly share?: { scope: string; baseSha: string }
	) {
		this.layout = layout ?? sandboxLayout(checkout);
	}

	/** Which of the common interpreters a sandboxed command can run. */
	runtimes(): string[] {
		return RUNTIMES.filter((tool) => Bun.which(tool, { PATH: this.layout.env.PATH }));
	}

	/**
	 * What a check run here depends on, once the install is done. Null when the
	 * result could not be told to repeat: the review has no repo scope, the
	 * install is not keyed by a lockfile (or runs code the key cannot cover), or
	 * the tool versions could not be read.
	 */
	async checkInputs(installCommand: string): Promise<CheckInputs | null> {
		await this.setupDone?.catch(() => undefined);

		if (!this.share) return null;

		const dependencies = await installKey((args) => this.git(args), this.headSha, installCommand, JS_LOCKFILES);

		if (!dependencies) return null;

		const versions = await this.exclusive(() =>
			runSandboxed(this.layout, TOOL_VERSIONS, { timeoutMs: 20_000, tier: 'light' })
		);

		if (versions.exitCode !== 0 || versions.timedOut) return null;

		return {
			scope: this.share.scope,
			headSha: this.headSha,
			dependencies,
			tools: `${process.platform}-${process.arch}\n${versions.output}`
		};
	}

	/** Install dependencies once. Runs wait for this; failures are reported, not thrown. */
	setup(onStep?: (step: SetupStep, result: RunResult | null) => void, signal?: AbortSignal): Promise<SetupReport> {
		this.setupDone ??= (async () => {
			const rootFiles = new Set(
				(await this.git(['ls-tree', '--name-only', this.headSha])).stdout.split('\n').filter(Boolean)
			);

			const plan = setupPlan(rootFiles, (tool) => Boolean(Bun.which(tool, { PATH: this.layout.env.PATH })));

			const host = {
				layout: this.layout,
				headSha: this.headSha,
				share: this.share,
				git: (args: string[]) => this.git(args),
				install: (command: string) =>
					this.exclusive(() =>
						runSandboxed(this.layout, command, {
							network: true,
							tier: 'prep',
							timeoutMs: () => this.timeout(REVIEW_POLICY.setupTimeoutMs),
							signal
						})
					)
			};

			const setup = await runSetup(host, this.checkout, plan.steps, onStep, signal);

			this.releaseShared = setup.release;

			return { steps: setup.steps, missing: plan.missing } satisfies SetupReport;
		})();

		return this.setupDone;
	}

	/** Run one reviewer command, offline, after setup, with `owner`'s scratch files in place. */
	async run(command: string, timeoutMs: number, signal?: AbortSignal, owner = ''): Promise<RunResult> {
		await this.setupDone?.catch(() => undefined);

		return this.exclusive(async () => {
			const limit = this.timeout(timeoutMs);

			if (limit <= 0) return notRun('Not run: the review is out of time.', true);

			const files = this.scratch.get(owner) ?? new Map<string, string>();

			try {
				const placed = await this.place(files, signal);

				if (placed) return notRun(`Not run: could not write scratch file ${placed}.`, false);

				return await runSandboxed(this.layout, command, { timeoutMs: () => this.timeout(timeoutMs), signal });
			} finally {
				await this.remove([...files.keys()]);
				await this.restoreTracked();
			}
		}, owner);
	}

	/**
	 * Run a command, offline, on a copy of the merge-base commit with `owner`'s
	 * scratch files in place, the way `run` does on the head. The copy is built
	 * once and put back after every command. `unavailable` says why it could not
	 * be used: changed dependencies, no time left, or a copy that would not build.
	 */
	async runOnBase(
		command: string,
		mergeBaseSha: string,
		timeoutMs: number,
		signal?: AbortSignal,
		owner = ''
	): Promise<RunResult | { unavailable: string }> {
		await this.setupDone?.catch(() => undefined);

		return this.exclusive(async () => {
			if (this.timeout(timeoutMs) <= 0) return { unavailable: 'the review is out of time' };

			const tree = (this.baseTree ??= new BaseTree(this.layout, this.headSha, mergeBaseSha));

			const unavailable = await tree.prepare(
				AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)])
			);

			if (unavailable) return { unavailable };

			const files = this.scratch.get(owner) ?? new Map<string, string>();

			try {
				const placed = await this.place(files, signal, tree.sandbox);

				if (placed) return { unavailable: `could not write scratch file ${placed}` };

				return await runSandboxed(tree.sandbox, command, { timeoutMs: () => this.timeout(timeoutMs), signal });
			} finally {
				await this.remove([...files.keys()], tree.sandbox);
				await tree.restore().catch(() => undefined);
			}
		}, owner);
	}

	/**
	 * Create or overwrite one of `owner`'s scratch files. It is test-written and
	 * removed at once so a bad path fails here, then kept host-side until the
	 * owner runs a command. Writes happen inside the sandbox, so a symlink
	 * planted in the checkout cannot redirect them to the host.
	 */
	async writeFile(
		path: string,
		content: string,
		signal?: AbortSignal,
		owner = ''
	): Promise<{ ok: true } | { ok: false; error: string }> {
		const clean = sanitizeRepoPath(path);

		if (!clean) return { ok: false, error: 'invalid path' };
		if (clean === '.git' || clean.startsWith('.git/')) return { ok: false, error: 'cannot write inside .git' };
		if (content.length > REVIEW_POLICY.maxWriteFileChars)
			return { ok: false, error: `content exceeds ${REVIEW_POLICY.maxWriteFileChars} characters` };

		const tracked = await this.git(['ls-tree', '--name-only', this.headSha, '--', clean]);

		if (tracked.stdout.trim())
			return { ok: false, error: 'path is tracked in the PR; write a new scratch file instead' };
		await this.setupDone?.catch(() => undefined);

		const result = await this.exclusive(async () => {
			const written = await this.writeNew(clean, content, signal);

			if (written.exitCode === 0) await this.remove([clean]);

			return written;
		}, owner);

		if (result.exitCode !== 0) return { ok: false, error: result.output.trim().slice(0, 400) || 'write failed' };

		const files = this.scratch.get(owner) ?? new Map<string, string>();

		files.set(clean, content);
		this.scratch.set(owner, files);

		return { ok: true };
	}

	/** `package.json` scripts across the repo (skipping vendored dirs), as `dir: name → command` lines. */
	async scripts(limit = 60): Promise<string[]> {
		const listed = await this.git(['ls-tree', '-r', '--name-only', this.headSha]);

		const manifests = listed.stdout
			.split('\n')
			.filter(
				(path) =>
					/(^|\/)package\.json$/.test(path) &&
					!/(^|\/)(node_modules|vendor|dist|build|fixtures?)\//.test(path) &&
					path.split('/').length <= 4
			)
			.slice(0, 30);

		const lines: string[] = [];

		for (const path of manifests) {
			const shown = await this.git(['show', `${this.headSha}:${path}`]);
			let scripts: unknown;

			try {
				scripts = (JSON.parse(shown.stdout) as { scripts?: unknown }).scripts;
			} catch {
				continue;
			}

			if (!scripts || typeof scripts !== 'object') continue;

			const dir = path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length);

			for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
				if (typeof command !== 'string') continue;
				lines.push(`${dir}: ${name} → ${command.slice(0, 160)}`);
				if (lines.length >= limit) return lines;
			}
		}

		return lines;
	}

	/** Remove any scratch file a crashed run left behind, restore tracked ones and drop the merge-base copy. Safe to call more than once. */
	async cleanup(): Promise<void> {
		const files = [...this.scratch.values()].flatMap((owned) => [...owned.keys()]);

		this.scratch.clear();

		await this.exclusive(async () => {
			await this.remove(files);
			await this.restoreTracked();
			await this.baseTree?.remove().catch(() => undefined);
		});

		this.releaseShared();
		await removeLayers(this.layout).catch(() => undefined);
	}

	/** Writes each scratch file under `layout`; returns the first path that could not be written. */
	private async place(
		files: Map<string, string>,
		signal?: AbortSignal,
		layout: SandboxLayout = this.layout
	): Promise<string | null> {
		for (const [path, content] of files) {
			if ((await this.writeNew(path, content, signal, layout)).exitCode !== 0) return path;
		}

		return null;
	}

	/**
	 * Writes a file that must not exist yet. An untracked file already there
	 * (installed dependencies, build output) is refused, because scratch files
	 * are removed after every run.
	 */
	private writeNew(
		path: string,
		content: string,
		signal?: AbortSignal,
		layout: SandboxLayout = this.layout
	): Promise<RunResult> {
		const target = quote(path);

		return runSandboxed(
			layout,
			`if [ -e ${target} ] || [ -L ${target} ]; then echo 'path already exists in the checkout; write a new scratch file instead' >&2; exit 1; fi; mkdir -p -- "$(dirname -- ${target})" && cat > ${target}`,
			{ timeoutMs: 10_000, stdin: content, signal, tier: 'light' }
		);
	}

	private async remove(paths: string[], layout: SandboxLayout = this.layout): Promise<void> {
		if (!paths.length) return;

		await runSandboxed(layout, `rm -f -- ${paths.map(quote).join(' ')}`, {
			timeoutMs: 10_000,
			tier: 'light'
		}).catch(() => undefined);
	}

	private timeout(requested: number): number {
		return Math.max(0, Math.min(requested, this.deadlineAt - reviewNow()));
	}

	/** Tells `watcher` as each of `owner`'s calls queues, starts and ends, until the returned function is called. */
	watchQueue(owner: string, watcher: QueueWatcher): () => void {
		this.watchers.set(owner, watcher);

		return () => this.watchers.delete(owner);
	}

	private exclusive<T>(fn: () => Promise<T>, owner = ''): Promise<T> {
		const watcher = this.watchers.get(owner);

		const start = () => {
			watcher?.started();

			return fn().finally(() => watcher?.finished());
		};

		watcher?.queued();

		const next = this.queue.then(start, start);

		this.queue = next.catch(() => undefined);

		return next;
	}

	/** Undo edits to tracked files (commands may format, build or patch in place). */
	private async restoreTracked(): Promise<void> {
		const status = await this.git(['status', '--porcelain', '--untracked-files=no']);

		if (status.code === 0 && !status.stdout.trim()) return;
		await this.git(['checkout', '--force', this.headSha, '--', '.']);
	}

	private async git(args: string[]): Promise<{ code: number; stdout: string }> {
		const proc = Bun.spawn(['git', ...args], {
			cwd: this.checkout,
			stdout: 'pipe',
			stderr: 'ignore',
			stdin: 'ignore',
			env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
		});

		const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

		return { code, stdout };
	}
}

/** A run that never started, shaped like one that did. */
function notRun(output: string, timedOut: boolean): RunResult {
	return { exitCode: null, output, truncated: false, timedOut, elapsedMs: 0 };
}

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
