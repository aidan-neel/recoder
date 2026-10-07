import { colorsFor, OTHER_COLOR } from '$lib/charts/series';
import type { LegendItem, XyPoint } from '$lib/charts/types';
import { minutes, percent, recall, shortDate } from './stats';
import type { ReportEntry } from './types';

/** The palette slots configs may take; the rest share Other. */
const NAMED = 7;

/** Config ids, most reports first, from every report so a filter never repaints a config. */
export function rankConfigs(entries: readonly ReportEntry[]): string[] {
	const counts = new Map<string, number>();

	for (const entry of entries) counts.set(entry.config.id, (counts.get(entry.config.id) ?? 0) + 1);

	return [...counts.keys()].toSorted((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
}

/** Each config's color: the top seven by report count get a palette slot, the rest share Other. */
export function configColors(ranked: readonly string[]): Map<string, string> {
	const colors = colorsFor(ranked.slice(0, NAMED));

	for (const id of ranked.slice(NAMED)) colors.set(id, OTHER_COLOR);

	return colors;
}

/** The legend for the configs present in `entries`. */
export function configLegend(entries: readonly ReportEntry[], ranked: readonly string[]): LegendItem[] {
	const present = new Set(entries.map((entry) => entry.config.id));
	const colors = configColors(ranked);
	const named = ranked.slice(0, NAMED).filter((id) => present.has(id));
	const other = ranked.slice(NAMED).some((id) => present.has(id));

	return [
		...named.map((id) => ({
			label: entries.find((entry) => entry.config.id === id)!.config.reviewer,
			color: colors.get(id)!,
			shape: 'dot' as const
		})),
		...(other ? [{ label: 'Other configs', color: OTHER_COLOR, shape: 'dot' as const }] : [])
	];
}

/** A run has every expected review saved. */
export function finished(entry: ReportEntry): boolean {
	return entry.runsPassed + entry.runsFailed >= entry.runsExpected;
}

/** Reports join into one line only when the same config ran the same PRs the same number of times. */
function lineKey(entry: ReportEntry): string {
	return [entry.config.id, entry.host, entry.dataset, entry.runsPerPr, entry.prIds.join(',')].join('|');
}

function point(entry: ReportEntry, colors: Map<string, string>, x: number): XyPoint | null {
	const share = recall(entry.overall);

	if (share === null) return null;

	return {
		x,
		y: share,
		series: lineKey(entry),
		color: colors.get(entry.config.id) ?? OTHER_COLOR,
		hollow: !finished(entry),
		href: `/reports/${entry.key}`,
		title: `${entry.dataset} · ${shortDate(entry.startedAt)}`,
		rows: [
			{ label: 'Recall', value: `${percent(share)} · ${entry.overall.found}/${entry.overall.planted}` },
			{ label: 'Reviewer', value: entry.config.reviewer },
			{ label: 'Judge', value: entry.config.judge },
			{ label: 'Runs', value: `${entry.runsPassed}/${entry.runsExpected}${finished(entry) ? '' : ', partial'}` },
			{
				label: 'Per review',
				value: entry.meanReviewMinutes === null ? '–' : minutes(entry.meanReviewMinutes * 60_000)
			},
			{ label: 'Host', value: entry.hostLabel }
		]
	};
}

/** Recall over time, a point per report. */
export function trendPoints(entries: readonly ReportEntry[], ranked: readonly string[]): XyPoint[] {
	const colors = configColors(ranked);

	return entries.flatMap((entry) => point(entry, colors, Date.parse(entry.startedAt)) ?? []);
}

/** Recall against minutes per review, a point per report that has both. */
export function costPoints(entries: readonly ReportEntry[], ranked: readonly string[]): XyPoint[] {
	const colors = configColors(ranked);

	return entries.flatMap((entry) =>
		entry.meanReviewMinutes === null ? [] : (point(entry, colors, entry.meanReviewMinutes) ?? [])
	);
}
