import { reviewNow } from './review-control.js';
import { REVIEW_POLICY } from './review-policy.js';
import { runSandboxed, sandboxLayout, type RunResult, type SandboxLayout } from './exec-sandbox.js';
import { sanitizeRepoPath } from './evidence.js';

/**
 * One review's execution environment: the PR checkout inside bubblewrap.
 * Commands run one at a time (agents share the checkout), start only after
 * dependency setup finishes, and never outlive the review deadline. Tracked
 * files are restored after each command so one agent's edits never leak into
 * another's evidence; scratch files agents write are removed when the review ends.
 */

export interface SetupStep {
	/** Why this step was picked, e.g. `bun.lock`. */
	marker: string;
	command: string;
}

export interface SetupReport {
	steps: Array<SetupStep & { exitCode: number | null; output: string; elapsedMs: number }>;
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
		{ files: ['pnpm-lock.yaml'], tool: 'pnpm', command: 'pnpm install --frozen-lockfile --ignore-scripts' },
		{ files: ['.yarnrc.yml'], tool: 'yarn', command: 'yarn install --immutable --mode=skip-build' },
		{ files: ['yarn.lock'], tool: 'yarn', command: 'yarn install --frozen-lockfile --ignore-scripts' },
		{ files: ['package-lock.json'], tool: 'npm', command: 'npm ci --ignore-scripts --no-audit --no-fund' },
		{ files: ['package.json'], tool: 'npm', command: 'npm install --ignore-scripts --no-audit --no-fund' }
	],
	[
		{ files: ['uv.lock'], tool: 'uv', command: 'uv sync --frozen' },
		{ files: ['poetry.lock'], tool: 'poetry', command: 'poetry install --no-root --no-interaction' },
		{ files: ['requirements.txt'], tool: 'python3', command: 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt' }
	],
	[{ files: ['go.mod'], tool: 'go', command: 'go mod download' }],
	[{ files: ['Cargo.toml'], tool: 'cargo', command: 'cargo fetch' }]
];

/** Install steps for the repo root's lockfiles; tools missing from PATH are reported, not run. */
export function setupPlan(rootFiles: Set<string>, has: (tool: string) => boolean): { steps: SetupStep[]; missing: string[] } {
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

export class ExecWorkspace {
	readonly layout: SandboxLayout;
	/** Runs past this moment are cut short; set by the harness. */
	deadlineAt = Number.POSITIVE_INFINITY;
	private queue: Promise<unknown> = Promise.resolve();
	private setupDone: Promise<SetupReport> | null = null;
	private readonly scratch = new Set<string>();

	constructor(
		readonly checkout: string,
		readonly headSha: string,
		layout?: SandboxLayout
	) {
		this.layout = layout ?? sandboxLayout(checkout);
	}

	/** Install dependencies once. Runs wait for this; failures are reported, not thrown. */
	setup(onStep?: (step: SetupStep, result: RunResult | null) => void, signal?: AbortSignal): Promise<SetupReport> {
		this.setupDone ??= (async () => {
			const rootFiles = new Set((await this.git(['ls-tree', '--name-only', this.headSha])).stdout.split('\n').filter(Boolean));
			const plan = setupPlan(rootFiles, (tool) => Boolean(Bun.which(tool, { PATH: this.layout.env.PATH })));
			const report: SetupReport = { steps: [], missing: plan.missing };
			for (const step of plan.steps) {
				if (signal?.aborted) break;
				onStep?.(step, null);
				const result = await this.exclusive(() => runSandboxed(this.layout, step.command, {
					network: true,
					timeoutMs: this.timeout(REVIEW_POLICY.setupTimeoutMs),
					signal
				}));
				onStep?.(step, result);
				report.steps.push({ ...step, exitCode: result.exitCode, output: result.output, elapsedMs: result.elapsedMs });
			}
			return report;
		})();
		return this.setupDone;
	}

	/** Run one reviewer command, offline, after setup. */
	async run(command: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
		await this.setupDone?.catch(() => undefined);
		return this.exclusive(async () => {
			const limit = this.timeout(timeoutMs);
			if (limit <= 0) return { exitCode: null, output: 'Not run: the review is out of time.', truncated: false, timedOut: true, elapsedMs: 0 };
			try {
				return await runSandboxed(this.layout, command, { timeoutMs: limit, signal });
			} finally {
				await this.restoreTracked();
			}
		});
	}

	/**
	 * Create or overwrite an untracked scratch file. The write happens inside the
	 * sandbox, so a symlink planted in the checkout cannot redirect it to the host.
	 */
	async writeFile(path: string, content: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
		const clean = sanitizeRepoPath(path);
		if (!clean) return { ok: false, error: 'invalid path' };
		if (clean === '.git' || clean.startsWith('.git/')) return { ok: false, error: 'cannot write inside .git' };
		if (content.length > REVIEW_POLICY.maxWriteFileChars) return { ok: false, error: `content exceeds ${REVIEW_POLICY.maxWriteFileChars} characters` };
		const tracked = await this.git(['ls-tree', '--name-only', this.headSha, '--', clean]);
		if (tracked.stdout.trim()) return { ok: false, error: 'path is tracked in the PR; write a new scratch file instead' };
		await this.setupDone?.catch(() => undefined);
		const result = await this.exclusive(() => runSandboxed(this.layout, `mkdir -p -- "$(dirname -- ${quote(clean)})" && cat > ${quote(clean)}`, {
			timeoutMs: 10_000,
			stdin: content,
			signal
		}));
		if (result.exitCode !== 0) return { ok: false, error: result.output.trim().slice(0, 400) || 'write failed' };
		this.scratch.add(clean);
		return { ok: true };
	}

	/** `package.json` scripts across the repo (skipping vendored dirs), as `dir: name → command` lines. */
	async scripts(limit = 60): Promise<string[]> {
		const listed = await this.git(['ls-tree', '-r', '--name-only', this.headSha]);
		const manifests = listed.stdout.split('\n')
			.filter((path) => /(^|\/)package\.json$/.test(path) && !/(^|\/)(node_modules|vendor|dist|build|fixtures?)\//.test(path) && path.split('/').length <= 4)
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

	/** Remove scratch files and restore tracked ones. Safe to call more than once. */
	async cleanup(): Promise<void> {
		const files = [...this.scratch];
		this.scratch.clear();
		await this.exclusive(async () => {
			if (files.length) {
				await runSandboxed(this.layout, `rm -f -- ${files.map(quote).join(' ')}`, { timeoutMs: 10_000 }).catch(() => undefined);
			}
			await this.restoreTracked();
		});
	}

	private timeout(requested: number): number {
		return Math.max(0, Math.min(requested, this.deadlineAt - reviewNow()));
	}

	private exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.queue.then(fn, fn);
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
		const proc = Bun.spawn(['git', ...args], { cwd: this.checkout, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
		const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		return { code, stdout };
	}
}

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
