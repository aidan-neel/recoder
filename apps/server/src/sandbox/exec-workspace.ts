import { reviewNow } from '../review/session/review-control.js';
import { REVIEW_POLICY } from '../review/session/review-policy.js';
import { runSandboxed, sandboxLayout, type RunResult, type SandboxLayout } from './exec-sandbox.js';
import { sanitizeRepoPath } from '../evidence/evidence.js';
import type { ExecutionOutcome } from '../evidence/types.js';
import { BaseTree } from './base-tree.js';
import { CheckoutLanes, lanesAvailable } from './checkout-lanes.js';
import { packageScripts, readCommitTree, type CommitTree } from './commit-tree.js';
import { installKey } from './install-inputs.js';
import { overwriteFile, placeFiles, removeFiles, writeNewFile } from './scratch-files.js';
import {
	JS_LOCKFILES,
	removeLayers,
	runSetup,
	setupPlan,
	type SetupReport,
	type SetupStep
} from './workspace-setup.js';

export type { CommitTree } from './commit-tree.js';

/**
 * One review's execution environment: the PR checkout inside the OS sandbox.
 * Commands start only after dependency setup finishes and never outlive the
 * review deadline. Tracked files are restored after each command, and scratch
 * files belong to the agent that wrote them, so one agent's edits and files
 * never reach another's run, test glob or verdict.
 *
 * Where the host can copy a tree cheaply ({@link lanesAvailable}), each agent
 * runs in its own copy of the prepared checkout, so the commands of different
 * agents run at the same time and its scratch files stay on disk there.
 * Elsewhere agents share the checkout: commands run one at a time, and an
 * agent's scratch files are on disk only while its own command runs.
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

/** A run of an investigator's command, with what it reached once the review's packages were prepared. */
export interface SettledRun extends RunResult {
	outcome?: ExecutionOutcome;
}

/** An investigator's finished run, handed to the harness to say what it reached. */
export interface InvestigatorRun {
	command: string;
	result: RunResult;
	owner: string;
	/** Runs the same command again, the same way. */
	rerun: () => Promise<RunResult>;
	signal?: AbortSignal;
	/** The command the outcome is classified as when `command` wraps the real run, as the matrix's file writes do; defaults to `command`. */
	classifyAs?: string;
	/** False keeps the outcome out of the review's Test outcomes tally; the mutation matrix reports its own row. */
	tally?: boolean;
}

export class ExecWorkspace {
	readonly layout: SandboxLayout;
	/** Runs past this moment are cut short; set by the harness. */
	deadlineAt = Number.POSITIVE_INFINITY;
	private queue: Promise<unknown> = Promise.resolve();
	private setupDone: Promise<SetupReport> | null = null;
	/** Each agent's scratch files, path → content: what its copy holds, or what is placed around its runs. */
	private readonly scratch = new Map<string, Map<string, string>>();
	/** The agents' private copies of the checkout; null where they share it. */
	private readonly lanes: CheckoutLanes | null;
	/** The merge-base copy, built the first time a command runs on it. */
	private baseTree: BaseTree | null = null;
	/** Lets go of the shared installs and stores this review holds. */
	private releaseShared: () => void = () => {};
	/** Set by the harness once packages are prepared: says what an investigator's run reached. */
	settleRun: ((run: InvestigatorRun) => Promise<SettledRun>) | null = null;
	/** The generation commands that prepared the head before the checks, in order; the merge-base tree runs the same. */
	private generation: readonly string[] = [];

	constructor(
		readonly checkout: string,
		readonly headSha: string,
		layout?: SandboxLayout,
		/** Lets reviews of one repo share installs: the repo's scope and the merge base. */
		private readonly share?: { scope: string; baseSha: string }
	) {
		this.layout = layout ?? sandboxLayout(checkout);
		this.lanes = lanesAvailable() ? new CheckoutLanes(this.layout, (work) => this.exclusive(work)) : null;
	}

	/** What the harness ran in the checkout before the checks; a stored check result is reused only after the same. */
	get preparedWith(): string {
		return this.generation.length ? `package prep: ${this.generation.join('; ')}` : '';
	}

	/** Records the generation commands that prepared the head, for the check cache key and the merge-base tree. */
	recordGeneration(commands: readonly string[]): void {
		this.generation = [...commands];
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
			tools: `${process.platform}-${process.arch}\n${versions.output}${this.preparedWith && `\n${this.preparedWith}`}`
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

	/**
	 * Run one command after setup, with `owner`'s scratch files in place: in the owner's copy of the checkout when
	 * it has one, otherwise in the checkout itself, after every command queued there before it.
	 */
	async run(command: string, timeoutMs: number, signal?: AbortSignal, owner = ''): Promise<RunResult> {
		await this.setupDone?.catch(() => undefined);

		const run = async (layout: SandboxLayout) => {
			if (this.timeout(timeoutMs) <= 0) return notRun('Not run: the review is out of time.', true);

			try {
				return await runSandboxed(layout, command, { timeoutMs: () => this.timeout(timeoutMs), signal });
			} finally {
				await this.restoreTracked(layout.checkout);
			}
		};

		const shared = async () => {
			const files = this.scratch.get(owner) ?? new Map<string, string>();

			try {
				const unplaced = await placeFiles(this.layout, files, signal);

				return unplaced ? notRun(`Not run: could not write scratch file ${unplaced}.`, false) : await run(this.layout);
			} finally {
				await removeFiles(this.layout, [...files.keys()]);
			}
		};

		return this.inLaneOr(owner, signal, run, shared);
	}

	/**
	 * Runs a command that prepares the checkout for every agent, such as code generation or a smoke run. What it
	 * leaves behind is part of the checkout from then on, so the agents' copies are made again before their next use.
	 */
	async prepare(command: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
		try {
			return await this.run(command, timeoutMs, signal);
		} finally {
			this.lanes?.invalidate();
		}
	}

	/** Lets go of what `owner` holds once it is done: its scratch files and its copy of the checkout. */
	release(owner: string): void {
		this.scratch.delete(owner);
		this.lanes?.release(owner);
	}

	/**
	 * Run an investigator's command the way `run` does; once packages are
	 * prepared, the result says what it reached. `settle.classifyAs` names the
	 * command the outcome is classified as when `command` only wraps it, and
	 * `settle.tally: false` keeps the outcome out of the Test outcomes tally.
	 */
	async runInvestigation(
		command: string,
		timeoutMs: number,
		signal?: AbortSignal,
		owner = '',
		settle?: { classifyAs?: string; tally?: boolean }
	): Promise<SettledRun> {
		const result = await this.run(command, timeoutMs, signal, owner);

		if (!this.settleRun) return result;

		return this.settleRun({
			command,
			result,
			owner,
			rerun: () => this.run(command, timeoutMs, signal, owner),
			signal,
			...settle
		});
	}

	/**
	 * Run a command on a copy of the merge-base commit with `owner`'s
	 * scratch files in place, the way `run` does on the head. The copy is built
	 * once, prepared with the head's generation commands, and put back after
	 * every command. `unavailable` says why it could not be used: changed
	 * dependencies, no time left, or a copy that would not build.
	 */
	async runOnBase(
		command: string,
		mergeBaseSha: string,
		timeoutMs: number,
		signal?: AbortSignal,
		owner = ''
	): Promise<RunResult | { unavailable: string }> {
		await this.setupDone?.catch(() => undefined);

		const work = async () => {
			if (this.timeout(timeoutMs) <= 0) return { unavailable: 'the review is out of time' };

			const tree = (this.baseTree ??= new BaseTree(this.layout, this.headSha, mergeBaseSha));
			const unavailable = await this.prepareBase(tree, timeoutMs, signal);

			if (unavailable) return { unavailable };

			const files = this.scratch.get(owner) ?? new Map<string, string>();

			try {
				const placed = await placeFiles(tree.sandbox, files, signal);

				if (placed) return { unavailable: `could not write scratch file ${placed}` };

				return await runSandboxed(tree.sandbox, command, { timeoutMs: () => this.timeout(timeoutMs), signal });
			} finally {
				await removeFiles(tree.sandbox, [...files.keys()]);
				await tree.restore().catch(() => undefined);
			}
		};

		return this.exclusive(work, { signal, instead: () => ({ unavailable: ABORTED }) });
	}

	/**
	 * Create or overwrite one of `owner`'s scratch files. In the owner's copy of
	 * the checkout the file stays where it is written. In a shared checkout it
	 * is test-written and removed at once so a bad path fails here, then kept
	 * host-side until the owner runs a command. Writes happen inside the
	 * sandbox, so a symlink planted in the checkout cannot redirect them to the host.
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

		const files = this.scratch.get(owner) ?? new Map<string, string>();

		const kept = (layout: SandboxLayout) =>
			files.has(clean) ? overwriteFile(layout, clean, content, signal) : writeNewFile(layout, clean, content, signal);

		const tried = async () => {
			const written = await writeNewFile(this.layout, clean, content, signal);

			if (written.exitCode === 0) await removeFiles(this.layout, [clean]);

			return written;
		};

		const result = await this.inLaneOr(owner, signal, kept, tried);

		if (result.exitCode !== 0) return { ok: false, error: result.output.trim().slice(0, 400) || 'write failed' };

		files.set(clean, content);
		this.scratch.set(owner, files);

		return { ok: true };
	}

	/** `package.json` scripts across the repo (skipping vendored dirs), as `dir: name → command` lines. */
	scripts(limit = 60): Promise<string[]> {
		return packageScripts((args) => this.git(args), this.headSha, limit);
	}

	/** The head commit's tracked files and their sizes, with a reader for their content. */
	commitTree(): Promise<CommitTree> {
		return readCommitTree((args) => this.git(args), this.headSha);
	}

	/** Remove any scratch file a crashed run left behind, restore tracked ones and drop the agents' copies and the merge-base copy. Safe to call more than once. */
	async cleanup(): Promise<void> {
		const files = [...this.scratch.values()].flatMap((owned) => [...owned.keys()]);

		this.scratch.clear();
		this.lanes?.removeAll();

		await this.exclusive(async () => {
			await removeFiles(this.layout, files);
			await this.restoreTracked();
			await this.baseTree?.remove().catch(() => undefined);
		});

		this.releaseShared();
		await removeLayers(this.layout).catch(() => undefined);
	}

	/**
	 * Builds the merge-base tree, then runs there, as prep commands, the head's
	 * generation commands it has not run yet, each within `timeoutMs`. Null when
	 * the tree is ready; otherwise why it can't be used, including a tree a
	 * generation command replaced.
	 */
	private async prepareBase(tree: BaseTree, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
		const built = await tree.prepare(AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]));

		if (built) return built;

		const generate = (command: string) =>
			runSandboxed(tree.sandbox, command, { timeoutMs: () => this.timeout(timeoutMs), tier: 'prep', signal });

		await tree.generate(this.generation, generate, signal);

		return tree.prepare();
	}

	/**
	 * Runs `work` in `owner`'s copy of the checkout, with the owner's scratch files there. A command with no
	 * owner, and every command on a host that cannot copy the checkout, runs `shared` instead, in the checkout
	 * itself, in its turn.
	 */
	private async inLaneOr(
		owner: string,
		signal: AbortSignal | undefined,
		work: (layout: SandboxLayout) => Promise<RunResult>,
		shared: () => Promise<RunResult>
	): Promise<RunResult> {
		const inTurn = () => this.exclusive(shared, { signal, instead: () => notRun(ABORTED, false) });

		if (!owner || !this.lanes) return inTurn();

		const ran = await this.lanes.use(owner, async (lane) => {
			if (signal?.aborted) return notRun(ABORTED, false);

			const files = lane.fresh ? (this.scratch.get(owner) ?? new Map<string, string>()) : new Map<string, string>();
			const unplaced = await placeFiles(lane.layout, files, signal);

			return unplaced ? notRun(`Not run: could not write scratch file ${unplaced}.`, false) : work(lane.layout);
		});

		return ran ?? inTurn();
	}

	private timeout(requested: number): number {
		return Math.max(0, Math.min(requested, this.deadlineAt - reviewNow()));
	}

	/** Runs `fn` after every call queued before it, or `skip.instead` when `skip.signal` aborted while it waited. */
	private exclusive<T>(fn: () => Promise<T>, skip?: { signal?: AbortSignal; instead: () => T }): Promise<T> {
		const turn = () => (skip?.signal?.aborted ? Promise.resolve(skip.instead()) : fn());
		const next = this.queue.then(turn, turn);

		this.queue = next.catch(() => undefined);

		return next;
	}

	/** Undo edits to tracked files under `root` (commands may format, build or patch in place). */
	private async restoreTracked(root: string = this.checkout): Promise<void> {
		const status = await this.git(['status', '--porcelain', '--untracked-files=no'], root);

		if (status.code === 0 && !status.stdout.trim()) return;
		await this.git(['checkout', '--force', this.headSha, '--', '.'], root);
	}

	private async git(args: string[], cwd: string = this.checkout): Promise<{ code: number; stdout: string }> {
		const proc = Bun.spawn(['git', ...args], {
			cwd,
			stdout: 'pipe',
			stderr: 'ignore',
			stdin: 'ignore',
			env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
		});

		const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

		return { code, stdout };
	}
}

/** What a call says when the review aborted while it waited its turn in the queue. */
const ABORTED = 'Not run: the review was aborted.';

/** A run that never started, shaped like one that did. */
export function notRun(output: string, timedOut: boolean): RunResult {
	return { exitCode: null, output, truncated: false, timedOut, elapsedMs: 0 };
}
