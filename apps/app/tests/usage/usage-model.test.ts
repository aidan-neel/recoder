import { describe, expect, test } from 'bun:test';

import { sampleUsageReport } from '../../src/lib/sample/sample-usage';
import type { UsageReport } from '@recoder/shared';

import {
	activePeople,
	findActivePerson,
	formatCost,
	formatSessions,
	modelColor,
	OTHERS_COLOR,
	personColor,
	tokenSegments,
	uncachedInput,
	unpricedNote,
	usageScope
} from '../../src/lib/usage/usage-model';
import { breakdownModes, breakdownRows, personRows, railRows } from '../../src/lib/usage/usage-rows';

const report = sampleUsageReport(30, Date.parse('2026-11-13T12:00:00Z'));
const person = findActivePerson(report, 'sample-mira');

if (!person) throw new Error('The sample report has no mira.');

describe('usage scope', () => {
	test('draws everyone’s days by person, one value for every day', () => {
		const scope = usageScope(report, null);

		expect(scope.series.map((line) => line.label)).toEqual(activePeople(report).map((active) => active.login));
		expect(scope.series.every((line) => line.values.length === report.daily.length)).toBe(true);
	});

	test('draws one person’s days by their models, and the parts add up to the person’s day', () => {
		const scope = usageScope(report, person);

		expect(scope.series.map((line) => line.label)).toEqual(person.models.map((model) => model.model));

		report.daily.forEach((day, index) => {
			const stacked = scope.series.reduce((sum, line) => sum + line.values[index], 0);

			expect(stacked).toBe(day.byPerson[person.accountId] ?? 0);
		});
	});

	test('totals one person’s view by their own tokens and leaves out the saving the report does not split', () => {
		const scope = usageScope(report, person);

		expect(scope.totals.tokens).toBe(person.tokens);
		expect(scope.cacheSavingsUsd).toBeNull();
	});

	test('ignores an address that names someone with no tokens or nobody', () => {
		expect(findActivePerson(report, 'sample-noor')?.login).toBe('noor');
		expect(findActivePerson(report, 'nobody')).toBeNull();
		expect(findActivePerson(sampleUsageReport(7, Date.parse('2026-11-13T12:00:00Z')), 'sample-noor')).toBeNull();
	});

	test('colors a person the same in the list, the chart and the table', () => {
		const lines = new Map(usageScope(report, null).series.map((line) => [line.label, line.color]));
		const rows = new Map(personRows(report).map((row) => [row.name, row.color]));

		expect(rows).toEqual(lines);
		expect(lines.get('mira')).toBe(personColor(report, 'sample-mira'));
	});

	test('colors a model the same in one person’s chart and in the models table', () => {
		const scope = usageScope(report, person);
		const rows = new Map(breakdownRows(report, scope, 'model').map((row) => [row.name, row.color]));

		for (const line of scope.series) expect(rows.get(line.label)).toBe(line.color);

		expect(modelColor(report, report.models[0].model)).toBe('var(--chart-1)');
	});
});

/** The sample report with `count` people, each a copy of the first under a new id. */
function withPeople(count: number): UsageReport {
	const first = report.people[0];
	const ids = Array.from({ length: count }, (_, index) => `person-${index}`);

	const people = ids.map((accountId, index) => ({
		...first,
		accountId,
		login: `p${index}`,
		tokens: first.tokens - index
	}));

	return {
		...report,
		people,
		daily: report.daily.map((day) => ({
			...day,
			byPerson: Object.fromEntries(ids.map((id) => [id, day.byPerson[first.accountId] ?? 0]))
		}))
	};
}

describe('colors past six', () => {
	test('gives six people a color each', () => {
		const six = withPeople(6);

		expect(usageScope(six, null).series.map((line) => line.color)).toEqual(
			Array.from({ length: 6 }, (_, index) => `var(--chart-${index + 1})`)
		);
	});

	test('folds everyone past the fifth into one grey line and one row, which add them up', () => {
		const eight = withPeople(8);
		const series = usageScope(eight, null).series;
		const rows = railRows(eight, usageScope(eight, null));

		expect(series).toHaveLength(6);
		expect(series[5]).toMatchObject({ label: '3 others', color: OTHERS_COLOR });
		expect(series[5].values[0]).toBe(3 * (eight.daily[0].byPerson['person-5'] ?? 0));
		expect(rows.map((row) => row.name)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', '3 others']);
		expect(rows[5].tokens).toBe(eight.people.slice(5).reduce((sum, item) => sum + item.tokens, 0));
	});
});

describe('usage rows', () => {
	test('splits a day by the chart’s lines, in their colors, and the parts add up to the day', () => {
		const [newest] = breakdownRows(report, usageScope(report, null), 'day');
		const day = report.daily[report.daily.length - 1];

		expect(newest.parts.reduce((sum, part) => sum + part.value, 0)).toBe(day.tokens);
		expect(newest.parts.every((part) => part.color === personColor(report, part.id))).toBe(true);
	});

	test('splits a model in everyone’s view by the people who used it', () => {
		const [top] = breakdownRows(report, usageScope(report, null), 'model');

		expect(top.color).toBeNull();
		expect(top.parts.reduce((sum, part) => sum + part.value, 0)).toBe(top.tokens);
	});

	test('lists days newest first and leaves out days with no tokens', () => {
		const quiet = { ...report, daily: report.daily.map((day, index) => (index === 3 ? { ...day, tokens: 0 } : day)) };
		const rows = breakdownRows(quiet, usageScope(quiet, null), 'day');

		expect(rows).toHaveLength(report.daily.length - 1);
		expect(rows[0].key).toBe(report.to);
	});

	test('lists only the days a person used tokens, with their share of their own tokens', () => {
		const rows = breakdownRows(report, usageScope(report, person), 'day');
		const active = report.daily.filter((day) => (day.byPerson[person.accountId] ?? 0) > 0);

		expect(rows).toHaveLength(active.length);
		expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
	});

	test('offers no Person grouping inside a person’s view', () => {
		expect(breakdownModes(usageScope(report, null))).toEqual(['model', 'day', 'person']);
		expect(breakdownModes(usageScope(report, person))).toEqual(['model', 'day']);
	});

	test('opens a person from their row only', () => {
		expect(personRows(report).every((row) => row.personId !== null)).toBe(true);
		expect(breakdownRows(report, usageScope(report, null), 'model').every((row) => row.personId === null)).toBe(true);
	});
});

describe('usage figures', () => {
	test('splits the tokens into four kinds that add up to the total', () => {
		const sum = tokenSegments(report.totals).reduce((total, segment) => total + segment.value, 0);

		expect(sum).toBe(report.totals.tokens);
		expect(uncachedInput(report.totals)).toBeGreaterThanOrEqual(0);
	});

	test('writes a dash for an unknown cost and keeps cents otherwise', () => {
		expect(formatCost(null)).toBe('—');
		expect(formatCost(12301.389)).toBe('$12,301.39');
	});

	test('names the models every cost leaves out for want of a price', () => {
		expect(unpricedNote(usageScope(report, null))).toBe('Costs leave out glm-5.2, which has no price.');
		expect(unpricedNote(usageScope(report, person))).toBeNull();
	});

	test('counts one session in the singular', () => {
		expect(formatSessions(1)).toBe('1 session');
		expect(formatSessions(1732)).toBe('1,732 sessions');
	});
});
