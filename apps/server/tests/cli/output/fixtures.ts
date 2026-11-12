import type { ReportDestination } from '../../../src/cli/output/deliver';
import type { OutputOptions } from '../../../src/cli/review/options';
import type { ReportFinding, ReviewReport } from '../../../src/cli/report/report';
import { PLAIN_SURFACE } from '../../../src/cli/terminal/surface';
import type { Terminal } from '../../../src/cli/terminal/terminal';

/** A program reading plain output, which is what most command tests check. */
export const PROGRAM_TERMINAL: Terminal = { audience: 'program', out: PLAIN_SURFACE, err: PLAIN_SURFACE };

/** A destination that drops everything, with the parts a test watches replaced. */
export function destination(overrides: Partial<ReportDestination> = {}): ReportDestination {
	return {
		writeStdout: async () => {},
		writeFile: async () => {},
		writeNote: () => {},
		out: PLAIN_SURFACE,
		err: PLAIN_SURFACE,
		...overrides
	};
}

export const OUTPUT: OutputOptions = {
	audience: 'program',
	format: 'json',
	file: null,
	progress: 'none',
	minSeverity: 'info',
	includeUnconfirmed: false,
	failOn: 'never'
};

export function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
	return { id: 'f1', file: 'src/a.ts', line: 3, severity: 'warning', message: 'It breaks.', ...overrides };
}

export function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
	return {
		schemaVersion: 1,
		outcome: 'complete',
		summary: 'Reviewed 2 files.',
		error: null,
		target: {
			kind: 'range',
			repoPath: '/repo',
			base: 'main',
			head: 'HEAD',
			baseSha: null,
			mergeBaseSha: null,
			headSha: '1234567890abcdef',
			since: null,
			sinceRunId: null,
			url: null,
			changedFiles: 2
		},
		settings: {
			budget: 'low',
			subagents: 3,
			reviewerModel: null,
			workerModel: null,
			reviewerEffort: null,
			workerEffort: null,
			lenses: null,
			include: [],
			exclude: [],
			reportLowSeverity: true,
			exec: true,
			execReason: null
		},
		findings: [],
		unconfirmed: [],
		recommendedChecks: [],
		coverage: { reviewed: 2, pending: 0, partial: 0, excluded: 0, total: 2 },
		coverageGaps: [],
		funnel: null,
		questions: null,
		obligations: null,
		startedAt: '2026-11-10T10:00:00.000Z',
		durationMs: 1500,
		...overrides
	};
}
