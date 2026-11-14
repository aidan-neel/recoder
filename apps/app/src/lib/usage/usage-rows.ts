import type { UsageKind, UsageModel, UsagePerson, UsageReport, UsageTotals } from '@recoder/shared';
import { formatCompact, formatShare, type ChartTipRow } from '@recoder/ui';

import {
	activePeople,
	failureRate,
	formatDuration,
	formatWhole,
	modelColor,
	moreModelsLabel,
	othersLabel,
	OTHERS_COLOR,
	OTHERS_ID,
	personColor,
	uncachedInput,
	type Cost,
	type UsageScope
} from './usage-model';

/** What the Breakdown table groups by. */
export type BreakdownMode = 'model' | 'day' | 'person';

/** What leads a row: a model's provider, a person's avatar, or nothing for a day or a folded row. */
export type RowLead =
	| { kind: 'model'; provider: string }
	| { kind: 'person'; login: string; avatarUrl: string | undefined }
	| { kind: 'none' };

/** One part of a row's tokens, in the color its line has in the chart. */
interface RowPart {
	id: string;
	label: string;
	color: string;
	value: number;
}

export interface UsageRow {
	key: string;
	name: string;
	lead: RowLead;
	/** Reviews and chats with a call in the window; null for a day. */
	sessions: number | null;
	/** Model calls, for the By kind rows; null elsewhere, where the tip has them. */
	calls: number | null;
	/** Absent for a day, which has no cost of its own. */
	cost: Cost | null;
	share: number;
	tokens: number;
	/** The row's line in the chart, when the chart draws one for it. */
	color: string | null;
	/** Set on a person's row: choosing the row opens that person's view. */
	personId: string | null;
	/** The row's tokens split by the chart's lines, in their order: the colored line under its name. */
	parts: RowPart[];
	/** The row's tokens by kind, for its tip; null for a day, which the report does not split by kind. */
	kinds: UsageTotals | null;
}

/** What a row's tip shows: its tokens, the split by the chart's lines and the split by kind. */
export interface RowTip {
	heading: string;
	value: string;
	rows: ChartTipRow[];
	details: ChartTipRow[];
}

/** The rows the Breakdown shows before Show all. */
export const BREAKDOWN_PAGE = 10;

const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A report day as a row's name: "Thu, Nov 13". */
function formatDay(day: string): string {
	return dayName.format(new Date(`${day}T00:00:00Z`));
}

function costOf(totals: UsageTotals): Cost {
	return { usd: totals.costUsd, complete: totals.costComplete };
}

/**
 * The parts with tokens, in the order given (the chart's lines' order, so
 * every row's colors run the same way), the grey ones past the fifth folded
 * into one at the end.
 */
function foldParts(parts: readonly RowPart[], label: (count: number) => string): RowPart[] {
	const present = parts.filter((part) => part.value > 0);
	const folded = present.filter((part) => part.color === OTHERS_COLOR);

	if (folded.length <= 1) return present;

	return [
		...present.filter((part) => part.color !== OTHERS_COLOR),
		{
			id: OTHERS_ID,
			label: label(folded.length),
			color: OTHERS_COLOR,
			value: folded.reduce((sum, part) => sum + part.value, 0)
		}
	];
}

/** How many tokens of `model` each person used, in their colors. */
function modelByPerson(report: UsageReport, model: string): RowPart[] {
	const parts = activePeople(report).map((person) => ({
		id: person.accountId,
		label: person.login,
		color: personColor(report, person.accountId),
		value: person.models.find((item) => item.model === model)?.tokens ?? 0
	}));

	return foldParts(parts, othersLabel);
}

function personRow(report: UsageReport, person: UsagePerson): UsageRow {
	const color = personColor(report, person.accountId);

	return {
		key: person.accountId,
		name: person.login,
		lead: { kind: 'person', login: person.login, avatarUrl: person.avatarUrl },
		sessions: person.sessions,
		calls: null,
		cost: costOf(person),
		share: person.share,
		tokens: person.tokens,
		color,
		personId: person.accountId,
		parts: [{ id: person.accountId, label: person.login, color, value: person.tokens }],
		kinds: person
	};
}

function modelRow(report: UsageReport, scope: UsageScope, model: UsageModel): UsageRow {
	const color = scope.person ? modelColor(report, model.model) : null;

	return {
		key: model.model,
		name: model.model,
		lead: { kind: 'model', provider: model.provider },
		sessions: model.sessions,
		calls: null,
		cost: costOf(model),
		share: model.share,
		tokens: model.tokens,
		color,
		personId: null,
		parts: color
			? [{ id: model.model, label: model.model, color, value: model.tokens }]
			: modelByPerson(report, model.model),
		kinds: model
	};
}

/** One row per person with tokens, most first. */
export function personRows(report: UsageReport): UsageRow[] {
	return activePeople(report).map((person) => personRow(report, person));
}

/** One row per model in the scope, most tokens first; in one person's view a share is of their tokens. */
function modelRows(report: UsageReport, scope: UsageScope): UsageRow[] {
	return scope.models.map((model) => modelRow(report, scope, model));
}

/** A day's tokens split the way the chart splits them: by person, or for one person by model. */
function dayParts(report: UsageReport, scope: UsageScope, day: UsageReport['daily'][number]): RowPart[] {
	const { person } = scope;

	if (person) {
		const split = day.byPersonModel[person.accountId] ?? {};

		const parts = person.models.map(({ model }) => ({
			id: model,
			label: model,
			color: modelColor(report, model),
			value: split[model] ?? 0
		}));

		return foldParts(parts, moreModelsLabel);
	}

	const parts = activePeople(report).map((active) => ({
		id: active.accountId,
		label: active.login,
		color: personColor(report, active.accountId),
		value: day.byPerson[active.accountId] ?? 0
	}));

	return foldParts(parts, othersLabel);
}

function dayRows(report: UsageReport, scope: UsageScope): UsageRow[] {
	return report.daily
		.map((day) => ({ day, parts: dayParts(report, scope, day) }))
		.map(({ day, parts }) => ({ day, parts, tokens: parts.reduce((sum, part) => sum + part.value, 0) }))
		.filter(({ tokens }) => tokens > 0)
		.map(({ day, parts, tokens }) => ({
			key: day.day,
			name: formatDay(day.day),
			lead: { kind: 'none' as const },
			sessions: null,
			calls: null,
			cost: null,
			share: scope.totals.tokens > 0 ? tokens / scope.totals.tokens : 0,
			tokens,
			color: null,
			personId: null,
			parts,
			kinds: null
		}))
		.reverse();
}

const KIND_NAMES: Record<UsageKind['kind'], string> = { review: 'Reviews', chat: 'Chats', other: 'Other' };

/** The color of a kind's share line: a grey, since a kind is not one of the chart's lines. */
const KIND_COLOR = 'var(--text-subtle)';

/** One row for each kind of model call, in the report's order; shares are of all tokens. */
export function kindRows(report: UsageReport): UsageRow[] {
	return report.kinds.map((kind) => ({
		key: kind.kind,
		name: KIND_NAMES[kind.kind],
		lead: { kind: 'none' as const },
		sessions: null,
		calls: kind.calls,
		cost: costOf(kind),
		share: report.totals.tokens > 0 ? kind.tokens / report.totals.tokens : 0,
		tokens: kind.tokens,
		color: null,
		personId: null,
		parts: [{ id: kind.kind, label: KIND_NAMES[kind.kind], color: KIND_COLOR, value: kind.tokens }],
		kinds: kind
	}));
}

/** The groupings the table offers: one person's view has no Person grouping. */
export function breakdownModes(scope: UsageScope): BreakdownMode[] {
	return scope.person ? ['model', 'day'] : ['model', 'day', 'person'];
}

/** The Breakdown table's rows for a mode: models and people by tokens, days newest first. */
export function breakdownRows(report: UsageReport, scope: UsageScope, mode: BreakdownMode): UsageRow[] {
	if (mode === 'person') return personRows(report);
	if (mode === 'day') return dayRows(report, scope);

	return modelRows(report, scope);
}

/** Adds up the counts of folded rows. Medians don't add up, so a folded row has no median duration. */
function sumKinds(rows: readonly UsageRow[]): UsageTotals | null {
	const kinds = rows.map((row) => row.kinds);

	if (kinds.some((item) => item === null)) return null;

	const all = kinds.filter((item): item is UsageTotals => item !== null);
	const add = (pick: (item: UsageTotals) => number) => all.reduce((sum, item) => sum + pick(item), 0);
	const priced = all.filter((item) => item.costUsd !== null);

	return {
		tokens: add((item) => item.tokens),
		input: add((item) => item.input),
		cacheRead: add((item) => item.cacheRead),
		cacheWrite: add((item) => item.cacheWrite),
		output: add((item) => item.output),
		sessions: add((item) => item.sessions),
		calls: add((item) => item.calls),
		failedCalls: add((item) => item.failedCalls),
		medianDurationMs: null,
		costUsd: priced.length === 0 ? null : priced.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
		costComplete: all.every((item) => item.costComplete)
	};
}

/** The rows beside the chart, one for each of its lines: the grey rows past the fifth fold into one, as the lines do. */
export function railRows(report: UsageReport, scope: UsageScope): UsageRow[] {
	const rows = scope.person ? modelRows(report, scope) : personRows(report);
	const folded = rows.filter((row) => row.color === OTHERS_COLOR);

	if (folded.length <= 1) return rows;

	const kinds = sumKinds(folded);
	const tokens = folded.reduce((sum, row) => sum + row.tokens, 0);
	const label = scope.person ? moreModelsLabel(folded.length) : othersLabel(folded.length);

	return [
		...rows.filter((row) => row.color !== OTHERS_COLOR),
		{
			key: OTHERS_ID,
			name: label,
			lead: { kind: 'none' },
			sessions: kinds?.sessions ?? null,
			calls: null,
			cost: kinds ? costOf(kinds) : null,
			share: folded.reduce((sum, row) => sum + row.share, 0),
			tokens,
			color: OTHERS_COLOR,
			personId: null,
			parts: [{ id: OTHERS_ID, label, color: OTHERS_COLOR, value: tokens }],
			kinds
		}
	];
}

/** A row's calls, how many failed and the typical time; a group with no calls, or a folded row with no median, leaves them out. */
function callDetails(totals: UsageTotals): ChartTipRow[] {
	if (totals.calls === 0) return [];

	const rate = failureRate(totals);

	const details: ChartTipRow[] = [
		{ id: 'calls', label: 'Calls', value: formatWhole(totals.calls) },
		{
			id: 'failed-calls',
			label: 'Failed',
			value: formatWhole(totals.failedCalls),
			detail: rate === null ? undefined : formatShare(rate)
		}
	];

	if (totals.medianDurationMs === null) return details;

	return [...details, { id: 'median', label: 'Typical time', value: formatDuration(totals.medianDurationMs) }];
}

/** A row's tip: its tokens, then each line's part with its share of the row, then the tokens by kind. */
export function rowTip(row: UsageRow): RowTip {
	const rows =
		row.parts.length > 1
			? row.parts.map((part) => ({
					id: part.id,
					label: part.label,
					color: part.color,
					value: formatCompact(part.value),
					detail: formatShare(part.value / row.tokens)
				}))
			: [];

	const details = row.kinds
		? [
				...callDetails(row.kinds),
				{ id: 'input', label: 'Input', value: formatCompact(uncachedInput(row.kinds)) },
				{ id: 'cache-read', label: 'Cache read', value: formatCompact(row.kinds.cacheRead) },
				{ id: 'cache-write', label: 'Cache write', value: formatCompact(row.kinds.cacheWrite) },
				{ id: 'output', label: 'Output', value: formatCompact(row.kinds.output) }
			]
		: [];

	return { heading: row.name, value: formatCompact(row.tokens), rows, details };
}
