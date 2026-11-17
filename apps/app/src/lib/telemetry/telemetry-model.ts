import type { TelemetryPerson, TelemetryRepo, TelemetryReport, TelemetryTotals } from '@recoder/shared';
import { formatCompact, type BarSegment, type ChartSeries } from '@recoder/ui';

import { foldSeries, formatWhole, othersLabel, rankColor } from '../usage/report-shared';

/**
 * What Settings → Telemetry looks at: everyone, or one person (`?person=<accountId>`).
 * Everything below the range picker reads from it so one person's view is the same page over their work.
 */
export interface TelemetryScope {
	person: TelemetryPerson | null;
	totals: TelemetryTotals;
	/** Repositories in the scope, most pull requests reviewed first. */
	repos: TelemetryRepo[];
	/** Daily pull requests reviewed: everyone's by person, one person's by repository, folded past six. */
	series: ChartSeries[];
}

/** True when the report has neither reviewed nor merged pull requests in its window. */
export function isEmptyTelemetry(report: TelemetryReport): boolean {
	return report.totals.prsReviewed === 0 && report.totals.prsMerged === 0 && report.totals.reviews === 0;
}

/** People with pull request review or merge activity in the window, most pull requests first. */
export function activeTelemetryPeople(report: TelemetryReport): TelemetryPerson[] {
	return report.people.filter((person) => person.prsReviewed > 0 || person.prsMerged > 0 || person.reviews > 0);
}

/** The active person matching `accountId`, or null when absent or inactive in this window. */
export function findActiveTelemetryPerson(report: TelemetryReport, accountId: string | null): TelemetryPerson | null {
	return activeTelemetryPeople(report).find((person) => person.accountId === accountId) ?? null;
}

/** A person's chart color, ranked among active people in the window. */
export function telemetryPersonColor(report: TelemetryReport, accountId: string): string {
	const people = activeTelemetryPeople(report);

	return rankColor(
		people.findIndex((person) => person.accountId === accountId),
		people.length
	);
}

/** A repository's chart color, ranked among repositories in the report so charts and tables agree. */
export function telemetryRepoColor(report: TelemetryReport, repoId: string): string {
	return rankColor(
		report.repos.findIndex((repo) => repo.repoId === repoId),
		report.repos.length
	);
}

/** "3 more repos", for one person's repositories folded past the fifth. */
export function moreReposLabel(count: number): string {
	return `${count} more repos`;
}

/** "42 reviews", and "1 review". */
export function formatReviews(count: number): string {
	return `${formatWhole(count)} ${count === 1 ? 'review' : 'reviews'}`;
}

/** Mean tokens per review ("184K"), or a dash when no review in the group recorded model calls. */
export function formatAvgTokens(avgTokensPerReview: number | null): string {
	return avgTokensPerReview === null ? '—' : formatCompact(avgTokensPerReview);
}

/** Share of decided findings that were accepted (`0` to `1`), or null when none were decided. */
export function acceptanceRate(totals: Pick<TelemetryTotals, 'findingsAccepted' | 'findingsDismissed'>): number | null {
	const decided = totals.findingsAccepted + totals.findingsDismissed;

	return decided === 0 ? null : totals.findingsAccepted / decided;
}

/** Share of decided findings that were dismissed (`0` to `1`), or null when none were decided. */
export function dismissalRate(totals: Pick<TelemetryTotals, 'findingsAccepted' | 'findingsDismissed'>): number | null {
	const decided = totals.findingsAccepted + totals.findingsDismissed;

	return decided === 0 ? null : totals.findingsDismissed / decided;
}

/** Share of reviewed pull requests merged in the window (`0` to `1`), or null when none were reviewed. */
export function mergeRate(totals: Pick<TelemetryTotals, 'prsReviewed' | 'prsMerged'>): number | null {
	if (totals.prsReviewed === 0) return null;

	return Math.min(1, totals.prsMerged / totals.prsReviewed);
}

/** Share of passed reviews started automatically (`0` to `1`), or null when no reviews ran. */
export function autoReviewShare(totals: Pick<TelemetryTotals, 'reviews' | 'autoReviews'>): number | null {
	return totals.reviews === 0 ? null : totals.autoReviews / totals.reviews;
}

function seriesByPerson(report: TelemetryReport): ChartSeries[] {
	return activeTelemetryPeople(report).map((person) => ({
		id: person.accountId,
		label: person.login,
		color: telemetryPersonColor(report, person.accountId),
		values: report.daily.map((day) => day.byPerson[person.accountId] ?? 0)
	}));
}

function seriesByRepo(report: TelemetryReport, person: TelemetryPerson): ChartSeries[] {
	return person.repos.map((repo) => ({
		id: repo.repoId,
		label: repo.name,
		color: telemetryRepoColor(report, repo.repoId),
		values: report.daily.map((day) => day.byPersonRepo[person.accountId]?.[repo.repoId] ?? 0)
	}));
}

/** Builds the scope for everyone (`null`) or for one active person. */
export function telemetryScope(report: TelemetryReport, person: TelemetryPerson | null): TelemetryScope {
	if (!person) {
		return {
			person: null,
			totals: report.totals,
			repos: report.repos,
			series: foldSeries(seriesByPerson(report), othersLabel)
		};
	}

	return {
		person,
		totals: person,
		repos: person.repos,
		series: foldSeries(seriesByRepo(report, person), moreReposLabel)
	};
}

/**
 * Findings split by severity for `StackedBar`. Uses the neutral text ramp so
 * chart hues exclusively mean people (in everyone's view) or repositories (in one person's view).
 */
export function severitySegments(totals: TelemetryTotals): BarSegment[] {
	return [
		{ id: 'high', label: 'High', value: totals.highFindings, color: 'var(--text-primary)' },
		{ id: 'medium', label: 'Medium', value: totals.mediumFindings, color: 'var(--text-tertiary)' },
		{ id: 'low', label: 'Low', value: totals.lowFindings, color: 'var(--text-subtle)' }
	];
}
