import { expect, test } from 'bun:test';
import type { CoverageGap, Finding } from '@recoder/shared';
import { buildReport, type ReportSource } from '../../../src/cli/run/build-report';
import type { AdaptiveReviewResult } from '../../../src/review/pipeline/harness/types';
import { fakeTarget } from './run-fixtures';

const SETTINGS: ReportSource['settings'] = {
	budget: 'medium',
	subagents: 8,
	reviewerModel: 'm',
	workerModel: 'm',
	reviewerEffort: null,
	workerEffort: null,
	lenses: null,
	reportLowSeverity: true,
	exec: false,
	execReason: 'no checkout'
};

const finding = (id: string, severity: Finding['severity'], file: string, line?: number): Finding => ({
	id,
	file,
	line,
	severity,
	message: `${id} message`,
	agent: 'reviewer-1',
	model: 'secret-model',
	fingerprint: 'abc',
	assignmentId: 'reviewer-1',
	memberIds: ['c1'],
	evidenceIds: ['ev_1']
});

const RESULT: AdaptiveReviewResult = {
	findings: [],
	unconfirmed: [],
	summary: 'Review complete. 0 findings.',
	outcome: 'complete',
	recommendedChecks: [],
	coverage: { reviewed: 1, pending: 0, partial: 0, excluded: 0, total: 1 },
	coverageGaps: [],
	assignments: []
};

function sourceOf(result: Partial<AdaptiveReviewResult>, stopReason: string | null = null): ReportSource {
	return {
		result: { ...RESULT, ...result },
		target: fakeTarget().target.report,
		settings: SETTINGS,
		stopReason,
		startedAtMs: Date.UTC(2026, 10, 10),
		endedAtMs: Date.UTC(2026, 10, 10) + 1500
	};
}

test('findings come out most severe first, then by file and line, without pipeline bookkeeping', () => {
	const report = buildReport(
		sourceOf({
			findings: [
				finding('f1', 'info', 'a.ts', 1),
				finding('f2', 'error', 'z.ts', 9),
				finding('f3', 'error', 'b.ts', 20),
				finding('f4', 'error', 'b.ts', 3),
				finding('f5', 'warning', 'a.ts')
			]
		})
	);

	expect(report.findings.map((item) => item.id)).toEqual(['f4', 'f3', 'f2', 'f5', 'f1']);

	for (const item of report.findings) {
		for (const key of ['agent', 'model', 'fingerprint', 'assignmentId', 'memberIds', 'evidenceIds']) {
			expect(key in item).toBe(false);
		}
	}
});

test('a failed review keeps the findings it returned and says why it failed', () => {
	const report = buildReport(
		sourceOf({
			outcome: 'failed',
			summary: 'The model refused.',
			findings: [finding('f1', 'warning', 'a.ts', 1)],
			unconfirmed: [finding('u1', 'info', 'a.ts', 2)]
		})
	);

	expect(report.outcome).toBe('failed');
	expect(report.error).toBe('The model refused.');
	expect(report.findings.map((item) => item.id)).toEqual(['f1']);
	expect(report.unconfirmed.map((item) => item.id)).toEqual(['u1']);
});

test('a run stopped by a signal is cancelled whatever the harness called it', () => {
	const report = buildReport(sourceOf({ outcome: 'failed' }, 'The review was cancelled.'));

	expect(report.outcome).toBe('cancelled');
	expect(report.error).toBe('The review was cancelled.');
});

test('the duration is the time between the two readings of the clock', () => {
	const report = buildReport(sourceOf({}));

	expect(report.durationMs).toBe(1500);
	expect(report.startedAt).toBe('2026-11-10T00:00:00.000Z');
});

/** A gap a reviewer could not close, for the hunk `index` of `a.ts`. */
const openGap = (index: number, reason: string): CoverageGap => ({
	path: 'a.ts',
	hunkId: `a.ts:${index}`,
	state: 'partial',
	reason
});

test('a complete run that reviewed none of the change fails with the reason most gaps give, and keeps them', () => {
	const coverageGaps = [openGap(1, 'Unable to connect.'), openGap(2, 'Unable to connect.'), openGap(3, 'Timed out.')];

	const report = buildReport(
		sourceOf({
			findings: [finding('f1', 'warning', 'a.ts', 1)],
			coverage: { reviewed: 0, pending: 0, partial: 3, excluded: 0, total: 3 },
			coverageGaps
		})
	);

	expect(report.outcome).toBe('failed');
	expect(report.error).toContain('Unable to connect.');
	expect(report.findings.map((item) => item.id)).toEqual(['f1']);
	expect(report.coverageGaps).toEqual(coverageGaps);
});

test('a complete run that reviewed part of the change stays complete with its gaps', () => {
	const report = buildReport(
		sourceOf({
			coverage: { reviewed: 1, pending: 0, partial: 2, excluded: 0, total: 3 },
			coverageGaps: [openGap(2, 'Unable to connect.'), openGap(3, 'Unable to connect.')]
		})
	);

	expect(report).toMatchObject({ outcome: 'complete', error: null });
});

test('a change whose every hunk was excluded from review is not a failure', () => {
	const report = buildReport(sourceOf({ coverage: { reviewed: 0, pending: 0, partial: 0, excluded: 2, total: 2 } }));

	expect(report).toMatchObject({ outcome: 'complete', error: null });
});
