import { describe, expect, test } from 'bun:test';

import { sampleUsageReport } from '../../src/lib/sample/sample-usage';
import { failureRate, formatDuration, usageScope } from '../../src/lib/usage/usage-model';
import { kindRows, railRows, rowTip } from '../../src/lib/usage/usage-rows';

const report = sampleUsageReport(30, Date.parse('2026-11-13T12:00:00Z'));

describe('call time', () => {
	test('shows milliseconds under a second and tenths of a second under a minute', () => {
		expect(formatDuration(850)).toBe('850ms');
		expect(formatDuration(4_200)).toBe('4.2s');
		expect(formatDuration(59_940)).toBe('59.9s');
	});

	test('rolls a time that rounds up to a minute over into minutes', () => {
		expect(formatDuration(59_960)).toBe('1m');
		expect(formatDuration(72_000)).toBe('1m 12s');
		expect(formatDuration(120_000)).toBe('2m');
		expect(formatDuration(3_900_000)).toBe('1h 5m');
	});

	test('shows a dash when no call recorded a duration', () => {
		expect(formatDuration(null)).toBe('—');
	});
});

describe('failure rate', () => {
	test('is the failed part of all calls', () => {
		expect(failureRate({ calls: 200, failedCalls: 5 })).toBe(0.025);
		expect(failureRate({ calls: 10, failedCalls: 0 })).toBe(0);
	});

	test('is null for a group with no calls', () => {
		expect(failureRate({ calls: 0, failedCalls: 0 })).toBeNull();
	});
});

describe('kind rows', () => {
	test('has a row for reviews, chats and other with their calls, and shares of all tokens that add up to one', () => {
		const rows = kindRows(report);

		expect(rows.map((row) => row.name)).toEqual(['Reviews', 'Chats', 'Other']);
		expect(rows.map((row) => row.calls)).toEqual(report.kinds.map((kind) => kind.calls));
		expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 2);
	});

	test('gives a kind with no tokens a zero share, not NaN', () => {
		const empty = { ...report, totals: { ...report.totals, tokens: 0 } };

		expect(kindRows(empty).every((row) => row.share === 0)).toBe(true);
	});
});

describe('row tips', () => {
	test('lists calls, failures and the typical time for a model', () => {
		const [top] = usageScope(report, null).models;
		const row = { ...railRows(report, usageScope(report, null))[0], kinds: top };
		const ids = rowTip(row).details.map((detail) => detail.id);

		expect(ids.slice(0, 3)).toEqual(['calls', 'failed-calls', 'median']);
	});

	test('leaves out the typical time of a folded row, which has no median', () => {
		const [top] = usageScope(report, null).models;
		const row = { ...railRows(report, usageScope(report, null))[0], kinds: { ...top, medianDurationMs: null } };
		const ids = rowTip(row).details.map((detail) => detail.id);

		expect(ids).toContain('calls');
		expect(ids).not.toContain('median');
	});

	test('leaves out every call figure for a group with no calls', () => {
		const [top] = usageScope(report, null).models;
		const row = { ...railRows(report, usageScope(report, null))[0], kinds: { ...top, calls: 0, failedCalls: 0 } };

		expect(rowTip(row).details.map((detail) => detail.id)).toEqual(['input', 'cache-read', 'cache-write', 'output']);
	});
});
