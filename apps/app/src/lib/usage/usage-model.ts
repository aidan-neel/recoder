import type { UsageModel, UsagePerson, UsageReport, UsageTotals } from '@recoder/shared';
import type { BarSegment, ChartSeries } from '@recoder/ui';

/** The chart tokens `--chart-1` to `--chart-6`. */
const CHART_COLORS = 6;

/** The color of whatever is folded together past the colored ones: a grey, so it never reads as one of them. */
export const OTHERS_COLOR = 'var(--text-faint)';

/** The id of the line and the row that add up everything past the fifth. */
export const OTHERS_ID = 'others';

/** What a cost shows: the dollars, or nothing known, or a sum that leaves out models with no price. */
export interface Cost {
	usd: number | null;
	complete: boolean;
}

/**
 * What the page looks at: everyone, or one person. Everything below the range
 * picker reads from it, so the person's view is the same page over their part.
 */
export interface UsageScope {
	person: UsagePerson | null;
	totals: UsageTotals;
	/** Null for one person: the report does not split the cache's saving by person. */
	cacheSavingsUsd: number | null;
	/** The models in the scope, most tokens first. */
	models: UsageModel[];
	/** The chart's lines: everyone's by person, one person's by model, the smallest folded past six. */
	series: ChartSeries[];
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const wholeNumber = new Intl.NumberFormat('en-US');
const modelList = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });

/**
 * The color of the `index`th of `count` things, most tokens first. Up to six
 * get one each; past six, the first five keep theirs and the rest share a grey.
 */
function rankColor(index: number, count: number): string {
	const colored = count <= CHART_COLORS ? CHART_COLORS : CHART_COLORS - 1;

	return index >= 0 && index < colored ? `var(--chart-${index + 1})` : OTHERS_COLOR;
}

/** Dollars with cents ($12,301.39), or a dash for a cost nobody knows. */
export function formatCost(value: number | null): string {
	return value === null ? '—' : usd.format(value);
}

/** A count in full, with separators: 1,350,000,000. */
export function formatWhole(value: number): string {
	return wholeNumber.format(value);
}

/** "1,732 sessions", and "1 session". */
export function formatSessions(count: number): string {
	return `${formatWhole(count)} ${count === 1 ? 'session' : 'sessions'}`;
}

/** How long a call took: "850ms", "4.2s", "1m 12s", "1h 5m"; a dash when no call recorded a duration. */
export function formatDuration(ms: number | null): string {
	if (ms === null) return '—';
	if (ms < MS_PER_SECOND) return `${Math.round(ms)}ms`;

	const tenths = Math.round(ms / (MS_PER_SECOND / 10));

	if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;

	const totalSeconds = Math.round(ms / MS_PER_SECOND);
	const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
	const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;

	if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;

	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** The part of a group's calls that failed, 0 to 1; null when it made no calls. */
export function failureRate(totals: Pick<UsageTotals, 'calls' | 'failedCalls'>): number | null {
	return totals.calls === 0 ? null : totals.failedCalls / totals.calls;
}

/** True when the report has no tokens at all in its window. */
export function isEmpty(report: UsageReport): boolean {
	return report.totals.tokens === 0;
}

/** A model's color: its rank in the report, so one person's chart and every table agree. */
export function modelColor(report: UsageReport, model: string): string {
	return rankColor(
		report.models.findIndex((item) => item.model === model),
		report.models.length
	);
}

/** The people with tokens in the window, most first. */
export function activePeople(report: UsageReport): UsagePerson[] {
	return report.people.filter((person) => person.tokens > 0);
}

/** A person's color: their rank among the people with tokens, so the chart, the list and the table agree. */
export function personColor(report: UsageReport, accountId: string): string {
	const people = activePeople(report);

	return rankColor(
		people.findIndex((person) => person.accountId === accountId),
		people.length
	);
}

/** The person with the id, if the report has them and they used any tokens. */
export function findActivePerson(report: UsageReport, accountId: string | null): UsagePerson | null {
	return activePeople(report).find((person) => person.accountId === accountId) ?? null;
}

/**
 * Folds the grey series into one line that adds them up, so a big team draws
 * six lines, not twenty. A lone grey series keeps its own name.
 */
function foldSeries(series: readonly ChartSeries[], othersLabel: (count: number) => string): ChartSeries[] {
	const shown = series.filter((line) => line.color !== OTHERS_COLOR);
	const folded = series.filter((line) => line.color === OTHERS_COLOR);

	if (folded.length <= 1) return [...series];

	const values = folded[0].values.map((_, index) => folded.reduce((sum, line) => sum + (line.values[index] ?? 0), 0));

	return [...shown, { id: OTHERS_ID, label: othersLabel(folded.length), color: OTHERS_COLOR, values }];
}

/** "3 others", for the people folded together. */
export function othersLabel(count: number): string {
	return `${count} others`;
}

/** "3 more models", for one person's models folded together. */
export function moreModelsLabel(count: number): string {
	return `${count} more models`;
}

/** One line per person with tokens, over every day of the window. */
function seriesByPerson(report: UsageReport): ChartSeries[] {
	return activePeople(report).map((person) => ({
		id: person.accountId,
		label: person.login,
		color: personColor(report, person.accountId),
		values: report.daily.map((day) => day.byPerson[person.accountId] ?? 0)
	}));
}

/** One line per model the person used, over every day of the window. */
function seriesByModel(report: UsageReport, person: UsagePerson): ChartSeries[] {
	return person.models.map((model) => ({
		id: model.model,
		label: model.model,
		color: modelColor(report, model.model),
		values: report.daily.map((day) => day.byPersonModel[person.accountId]?.[model.model] ?? 0)
	}));
}

/** The report seen as everyone (`null`), or as one person who used tokens in it. */
export function usageScope(report: UsageReport, person: UsagePerson | null): UsageScope {
	if (!person) {
		return {
			person: null,
			totals: report.totals,
			cacheSavingsUsd: report.totals.cacheSavingsUsd,
			models: report.models,
			series: foldSeries(seriesByPerson(report), othersLabel)
		};
	}

	return {
		person,
		totals: person,
		cacheSavingsUsd: null,
		models: person.models,
		series: foldSeries(seriesByModel(report, person), moreModelsLabel)
	};
}

/** Input that was neither read from nor written to the cache. */
export function uncachedInput(totals: UsageTotals): number {
	return Math.max(0, totals.input - totals.cacheRead - totals.cacheWrite);
}

/**
 * The line under Totals when some calls have no known price: which models
 * every cost on the page leaves out. Null when every cost is whole.
 */
export function unpricedNote(scope: UsageScope): string | null {
	const models = scope.models.filter((model) => !model.costComplete).map((model) => model.model);

	if (models.length === 0) return null;

	return `Costs leave out ${modelList.format(models)}, which ${models.length === 1 ? 'has' : 'have'} no price.`;
}

/**
 * The four kinds of token, for the stacked bar and its legend. They are
 * greys from the text ramp, so they never read as one of the people or
 * models the chart colors.
 */
export function tokenSegments(totals: UsageTotals): BarSegment[] {
	return [
		{ id: 'input', label: 'Input', value: uncachedInput(totals), color: 'var(--text-subtle)' },
		{ id: 'cache-read', label: 'Cache read', value: totals.cacheRead, color: 'var(--text-ghost)' },
		{ id: 'cache-write', label: 'Cache write', value: totals.cacheWrite, color: 'var(--text-tertiary)' },
		{ id: 'output', label: 'Output', value: totals.output, color: 'var(--text-primary)' }
	];
}
