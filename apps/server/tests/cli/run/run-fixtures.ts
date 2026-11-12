import { beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportTarget } from '../../../src/cli/report/report';
import type { ReviewOptions } from '../../../src/cli/review/options';
import type { ModelLookup } from '../../../src/cli/run/model-choices';
import { openRunSignal } from '../../../src/cli/run/run-signal';
import type { ResolvedTarget } from '../../../src/cli/target/resolve-target';
import { addedFile, restoreAfterEach } from '../../review/pipeline/harness-fixtures';

const DIFF = addedFile('src/a.ts', 5);

const REPORT_TARGET: ReportTarget = {
	kind: 'diff',
	repoPath: null,
	base: null,
	head: null,
	baseSha: null,
	mergeBaseSha: null,
	headSha: null,
	since: null,
	sinceRunId: null,
	url: null,
	changedFiles: 1
};

/** Options for a Medium review of a bare diff, with every field a caller can change set to its default. */
export function reviewOptions(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
	return {
		repoPath: '/repo',
		target: { kind: 'diff', source: '-' },
		scope: { include: [], exclude: [] },
		intent: { title: null, body: null, instructions: null },
		tuning: {
			budget: 'medium',
			subagents: null,
			reviewerModel: null,
			workerModel: null,
			verifierModel: null,
			reviewerEffort: null,
			workerEffort: null,
			lenses: null,
			reportLowSeverity: null,
			exec: true,
			baselineCache: true,
			maxFileChars: null,
			levers: []
		},
		output: {
			audience: 'program',
			format: 'json',
			file: null,
			progress: 'none',
			minSeverity: 'info',
			includeUnconfirmed: false,
			failOn: 'never'
		},
		timeoutMs: null,
		keepCheckout: false,
		...overrides
	};
}

/** A resolved bare diff whose `dispose` counts its calls. */
export function fakeTarget(): { target: ResolvedTarget; disposed: () => number } {
	let disposed = 0;

	const target: ResolvedTarget = {
		diff: DIFF,
		sandboxPath: null,
		revision: null,
		title: null,
		body: null,
		report: REPORT_TARGET,
		dispose: async () => {
			disposed++;
		}
	};

	return { target, disposed: () => disposed };
}

/** Restores the review settings and stubbed `fetch` after each test, and gives each its own data folder. */
export function isolateRun(): void {
	restoreAfterEach();

	beforeEach(() => {
		process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-cli-run-'));
	});
}

/** A model lookup under a run that is never stopped, given `limitMs` to answer. */
export function unstoppedLookup(limitMs: number): ModelLookup {
	return { stop: openRunSignal(new AbortController().signal, null), limitMs };
}
