import { describe, expect, test } from 'bun:test';
import type { TelemetryPerson, TelemetryReport } from '@recoder/shared';

import { sampleTelemetryReport } from '../../src/lib/sample/sample-telemetry';
import { canOpenSection, sectionsFor } from '../../src/lib/settings/sections';
import {
	acceptanceRate,
	activeTelemetryPeople,
	autoReviewShare,
	dismissalRate,
	findActiveTelemetryPerson,
	formatAvgTokens,
	isEmptyTelemetry,
	mergeRate,
	severitySegments,
	telemetryScope
} from '../../src/lib/telemetry/telemetry-model';
import {
	telemetryBreakdownModes,
	telemetryBreakdownRows,
	telemetryRailRows,
	telemetryRowTip
} from '../../src/lib/telemetry/telemetry-rows';
import { OTHERS_COLOR } from '../../src/lib/usage/report-shared';

const report = sampleTelemetryReport(30, Date.parse('2026-11-13T12:00:00Z'));
const mira = findActiveTelemetryPerson(report, 'sample-mira');

if (!mira) throw new Error('Expected sample-mira in sample telemetry report.');

describe('telemetry settings section gating', () => {
	test('exposes telemetry to admins and hides it from members', () => {
		expect(sectionsFor(true).map((section) => section.id)).toContain('telemetry');
		expect(sectionsFor(false).map((section) => section.id)).not.toContain('telemetry');
		expect(canOpenSection('telemetry', true)).toBe(true);
		expect(canOpenSection('telemetry', false)).toBe(false);
	});
});

describe('telemetry scope and rates', () => {
	test('plots everyone by active person and one person by their repositories', () => {
		const everyone = telemetryScope(report, null);

		expect(everyone.series.map((line) => line.label)).toEqual(
			activeTelemetryPeople(report).map((person) => person.login)
		);

		expect(everyone.series.every((line) => line.values.length === report.daily.length)).toBe(true);

		const single = telemetryScope(report, mira);

		expect(single.series.map((line) => line.label)).toEqual(mira.repos.map((repo) => repo.name));

		report.daily.forEach((day, index) => {
			const sum = single.series.reduce((acc, line) => acc + line.values[index], 0);

			expect(sum).toBe(day.byPerson[mira.accountId] ?? 0);
		});
	});

	test('folds past six people into a single grey others series and rail row', () => {
		const extraPeople: TelemetryPerson[] = Array.from({ length: 8 }, (_, idx) => ({
			...report.people[0],
			accountId: `extra-${idx}`,
			login: `dev-${idx}`,
			prsReviewed: 10 - idx,
			share: 1 / 8
		}));

		const crowded: TelemetryReport = { ...report, people: extraPeople };
		const scope = telemetryScope(crowded, null);
		const rail = telemetryRailRows(crowded, scope);

		expect(scope.series).toHaveLength(6);
		expect(scope.series[5]).toMatchObject({ label: '3 others', color: OTHERS_COLOR });
		expect(rail).toHaveLength(6);
		expect(rail[5]).toMatchObject({ name: '3 others', color: OTHERS_COLOR });
	});

	test('computes acceptance, dismissal, merge and auto-review rates and formats average tokens', () => {
		expect(acceptanceRate({ findingsAccepted: 3, findingsDismissed: 1 })).toBe(0.75);
		expect(dismissalRate({ findingsAccepted: 3, findingsDismissed: 1 })).toBe(0.25);
		expect(acceptanceRate({ findingsAccepted: 0, findingsDismissed: 0 })).toBeNull();
		expect(mergeRate({ prsReviewed: 10, prsMerged: 8 })).toBe(0.8);
		expect(mergeRate({ prsReviewed: 0, prsMerged: 0 })).toBeNull();
		expect(autoReviewShare({ reviews: 10, autoReviews: 6 })).toBe(0.6);
		expect(formatAvgTokens(null)).toBe('—');
		expect(formatAvgTokens(185_000)).toBe('185K');
		expect(severitySegments(report.totals).map((segment) => segment.label)).toEqual(['High', 'Medium', 'Low']);
		expect(isEmptyTelemetry(report)).toBe(false);
	});
});

describe('telemetry breakdown rows', () => {
	test('offers person, repo and day for everyone, and repo and day for one person', () => {
		const everyone = telemetryScope(report, null);
		const single = telemetryScope(report, mira);

		expect(telemetryBreakdownModes(everyone)).toEqual(['person', 'repo', 'day']);
		expect(telemetryBreakdownModes(single)).toEqual(['repo', 'day']);

		const personRows = telemetryBreakdownRows(report, everyone, 'person');
		const repoRows = telemetryBreakdownRows(report, everyone, 'repo');
		const singleDays = telemetryBreakdownRows(report, single, 'day');

		expect(personRows[0].personId).toBe(report.people[0].accountId);
		expect(personRows[0].showsAvgTokens).toBe(true);
		expect(telemetryRowTip(personRows[0]).details.map((detail) => detail.id)).toContain('avg-tokens');
		expect(repoRows[0].lead.kind).toBe('repo');
		expect(singleDays.every((row) => !row.showsDetailColumns && !row.showsAvgTokens)).toBe(true);
	});
});
