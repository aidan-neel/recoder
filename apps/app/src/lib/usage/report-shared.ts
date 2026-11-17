import { DEFAULT_USAGE_DAYS, type Provider, type UsageDays } from '@recoder/shared';
import type { ChartSeries, ChartTipRow } from '@recoder/ui';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { failureText, isOffline } from '../api/http';

/** The chart tokens `--chart-1` to `--chart-6`. */
const CHART_COLORS = 6;

/** The color of whatever is folded together past the colored ones: a grey, so it never reads as one of them. */
export const OTHERS_COLOR = 'var(--text-faint)';

/** The id of the line and the row that add up everything past the fifth. */
export const OTHERS_ID = 'others';

/** The rows a Breakdown table shows before Show all. */
export const BREAKDOWN_PAGE = 10;

/** What leads a row: a model's provider, a repository's forge, a person's avatar, or nothing. */
export type RowLead =
	| { kind: 'model'; provider: string }
	| { kind: 'repo'; provider: Provider }
	| { kind: 'person'; login: string; avatarUrl: string | undefined }
	| { kind: 'none' };

/** One part of a row's share bar, in the color its line has in the chart. */
export interface RowPart {
	id: string;
	label: string;
	color: string;
	value: number;
}

/** What a row's tooltip shows: its primary figure, the split by the chart's lines and extra details. */
export interface RowTip {
	heading: string;
	value: string;
	rows: ChartTipRow[];
	details: ChartTipRow[];
}

const wholeNumber = new Intl.NumberFormat('en-US');

const dayName = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC'
});

/** A count in full, with separators: 1,350,000,000. */
export function formatWhole(value: number): string {
	return wholeNumber.format(value);
}

/** A report day as a row's name: "Thu, Nov 13". */
export function formatReportDay(day: string): string {
	return dayName.format(new Date(`${day}T00:00:00Z`));
}

/**
 * The color of the `index`th of `count` things, highest first. Up to six
 * get one each; past six, the first five keep theirs and the rest share a grey.
 */
export function rankColor(index: number, count: number): string {
	const colored = count <= CHART_COLORS ? CHART_COLORS : CHART_COLORS - 1;

	return index >= 0 && index < colored ? `var(--chart-${index + 1})` : OTHERS_COLOR;
}

/** "3 others", for the people folded together. */
export function othersLabel(count: number): string {
	return `${count} others`;
}

/**
 * Folds the grey series into one line that adds them up, so a big team draws
 * six lines, not twenty. A lone grey series keeps its own name.
 */
export function foldSeries(series: readonly ChartSeries[], label: (count: number) => string): ChartSeries[] {
	const shown = series.filter((line) => line.color !== OTHERS_COLOR);
	const folded = series.filter((line) => line.color === OTHERS_COLOR);

	if (folded.length <= 1) return [...series];

	const values = folded[0].values.map((_, index) => folded.reduce((sum, line) => sum + (line.values[index] ?? 0), 0));

	return [...shown, { id: OTHERS_ID, label: label(folded.length), color: OTHERS_COLOR, values }];
}

/**
 * The parts above zero, in the order given (the chart's lines' order, so
 * every row's colors run the same way), the grey ones past the fifth folded
 * into one at the end.
 */
export function foldParts(parts: readonly RowPart[], label: (count: number) => string): RowPart[] {
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

/** `offline`: the review server did not answer. `error`: it answered with one. */
type ReportStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export interface ReportApi<Report> {
	report: (days: UsageDays) => Promise<Report>;
}

interface ReportStoreState<Report> {
	status: ReportStatus;
	/** The range picked in the page's bar; the report on screen catches up with it as it loads. */
	days: UsageDays;
	/** The last report read. It stays on screen while another range loads. */
	report: Report | null;
	/** The server's reason the last load failed; null when it never answered. */
	error: string | null;
	/** Picks the range; the open section reads its report. */
	setDays: (days: UsageDays) => void;
	/** Reads the report for `days`. A reply for a range the person has since left is dropped. */
	load: (api: ReportApi<Report>, days: UsageDays) => Promise<void>;
}

export type ReportStore<Report> = UseBoundStore<StoreApi<ReportStoreState<Report>>>;

/** Creates a Zustand store for a windowed admin report (`Usage` or `Telemetry`). */
export function createReportStore<Report>(fallbackError: string): ReportStore<Report> {
	return create<ReportStoreState<Report>>((set, get) => ({
		status: 'idle',
		days: DEFAULT_USAGE_DAYS,
		report: null,
		error: null,

		setDays: (days) => set({ days }),

		async load(api, days) {
			set({ days, ...(get().report ? {} : { status: 'loading' as const }) });

			try {
				const report = await api.report(days);

				if (get().days === days) set({ report, status: 'ready', error: null });
			} catch (error) {
				if (get().days !== days) return;

				set(
					isOffline(error)
						? { status: 'offline', error: null }
						: { status: 'error', error: failureText(error, fallbackError) }
				);
			}
		}
	}));
}
