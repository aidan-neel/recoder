import type { TelemetryPerson, TelemetryRepo, TelemetryReport, TelemetryTotals } from '@recoder/shared';
import { formatCompact, formatShare, type ChartTipRow } from '@recoder/ui';

import {
	foldParts,
	formatReportDay,
	formatWhole,
	OTHERS_COLOR,
	OTHERS_ID,
	othersLabel,
	type RowLead,
	type RowPart,
	type RowTip
} from '../usage/report-shared';
import {
	acceptanceRate,
	activeTelemetryPeople,
	autoReviewShare,
	formatAvgTokens,
	moreReposLabel,
	telemetryPersonColor,
	telemetryRepoColor,
	type TelemetryScope
} from './telemetry-model';

/** What the Telemetry Breakdown table groups by. */
export type TelemetryBreakdownMode = 'person' | 'repo' | 'day';

export interface TelemetryRow {
	key: string;
	name: string;
	lead: RowLead;
	prsReviewed: number;
	prsMerged: number;
	findingsAccepted: number;
	findingsBlocking: number;
	findingsDismissed: number;
	/** True when `Merged`, `Accepted`, `Blocking` and `Dismissed` apply to this row. */
	showsDetailColumns: boolean;
	/** Mean tokens per review; null on day rows and groups with no tracked calls. */
	avgTokensPerReview: number | null;
	/** True when the table shows an `Avg tokens` column (person and repository modes). */
	showsAvgTokens: boolean;
	share: number;
	color: string | null;
	personId: string | null;
	parts: RowPart[];
	totals: TelemetryTotals | null;
}

function repoByPersonParts(report: TelemetryReport, repoId: string): RowPart[] {
	const parts = activeTelemetryPeople(report).map((person) => ({
		id: person.accountId,
		label: person.login,
		color: telemetryPersonColor(report, person.accountId),
		value: person.repos.find((repo) => repo.repoId === repoId)?.prsReviewed ?? 0
	}));

	return foldParts(parts, othersLabel);
}

function personTelemetryRow(report: TelemetryReport, person: TelemetryPerson): TelemetryRow {
	const color = telemetryPersonColor(report, person.accountId);

	return {
		key: person.accountId,
		name: person.login,
		lead: { kind: 'person', login: person.login, avatarUrl: person.avatarUrl },
		prsReviewed: person.prsReviewed,
		prsMerged: person.prsMerged,
		findingsAccepted: person.findingsAccepted,
		findingsBlocking: person.findingsBlocking,
		findingsDismissed: person.findingsDismissed,
		showsDetailColumns: true,
		avgTokensPerReview: person.avgTokensPerReview,
		showsAvgTokens: true,
		share: person.share,
		color,
		personId: person.accountId,
		parts: [{ id: person.accountId, label: person.login, color, value: Math.max(1, person.prsReviewed) }],
		totals: person
	};
}

function repoTelemetryRow(report: TelemetryReport, scope: TelemetryScope, repo: TelemetryRepo): TelemetryRow {
	const color = scope.person ? telemetryRepoColor(report, repo.repoId) : null;

	return {
		key: repo.repoId,
		name: repo.name,
		lead: { kind: 'repo', provider: repo.provider },
		prsReviewed: repo.prsReviewed,
		prsMerged: repo.prsMerged,
		findingsAccepted: repo.findingsAccepted,
		findingsBlocking: repo.findingsBlocking,
		findingsDismissed: repo.findingsDismissed,
		showsDetailColumns: true,
		avgTokensPerReview: repo.avgTokensPerReview,
		showsAvgTokens: true,
		share: repo.share,
		color,
		personId: null,
		parts: color
			? [{ id: repo.repoId, label: repo.name, color, value: Math.max(1, repo.prsReviewed) }]
			: repoByPersonParts(report, repo.repoId),
		totals: repo
	};
}

/** One row per active person, most pull requests first. */
function telemetryPersonRows(report: TelemetryReport): TelemetryRow[] {
	return activeTelemetryPeople(report).map((person) => personTelemetryRow(report, person));
}

function telemetryRepoRows(report: TelemetryReport, scope: TelemetryScope): TelemetryRow[] {
	return scope.repos.map((repo) => repoTelemetryRow(report, scope, repo));
}

function dayTelemetryParts(
	report: TelemetryReport,
	scope: TelemetryScope,
	day: TelemetryReport['daily'][number]
): RowPart[] {
	if (scope.person) {
		const split = day.byPersonRepo[scope.person.accountId] ?? {};

		const parts = scope.person.repos.map((repo) => ({
			id: repo.repoId,
			label: repo.name,
			color: telemetryRepoColor(report, repo.repoId),
			value: split[repo.repoId] ?? 0
		}));

		return foldParts(parts, moreReposLabel);
	}

	const parts = activeTelemetryPeople(report).map((person) => ({
		id: person.accountId,
		label: person.login,
		color: telemetryPersonColor(report, person.accountId),
		value: day.byPerson[person.accountId] ?? 0
	}));

	return foldParts(parts, othersLabel);
}

function telemetryDayRows(report: TelemetryReport, scope: TelemetryScope): TelemetryRow[] {
	const allDaysPrs = report.daily.reduce((sum, day) => {
		const count = scope.person ? (day.byPerson[scope.person.accountId] ?? 0) : day.prsReviewed;

		return sum + count;
	}, 0);

	return report.daily
		.map((day) => {
			const parts = dayTelemetryParts(report, scope, day);
			const prsReviewed = scope.person ? (day.byPerson[scope.person.accountId] ?? 0) : day.prsReviewed;

			return { day, parts, prsReviewed };
		})
		.filter(({ day, prsReviewed }) => prsReviewed > 0 || (!scope.person && day.prsMerged > 0))
		.map(({ day, parts, prsReviewed }) => ({
			key: day.day,
			name: formatReportDay(day.day),
			lead: { kind: 'none' as const },
			prsReviewed,
			prsMerged: day.prsMerged,
			findingsAccepted: day.findingsAccepted,
			findingsBlocking: day.findingsBlocking,
			findingsDismissed: day.findingsDismissed,
			showsDetailColumns: !scope.person,
			avgTokensPerReview: null,
			showsAvgTokens: false,
			share: allDaysPrs > 0 ? prsReviewed / allDaysPrs : 0,
			color: null,
			personId: null,
			parts,
			totals: null
		}))
		.reverse();
}

/** Groupings the Breakdown offers: everyone's view starts on Person; one person's view offers Repository and Day. */
export function telemetryBreakdownModes(scope: TelemetryScope): TelemetryBreakdownMode[] {
	return scope.person ? ['repo', 'day'] : ['person', 'repo', 'day'];
}

/** Rows for the selected Breakdown mode. */
export function telemetryBreakdownRows(
	report: TelemetryReport,
	scope: TelemetryScope,
	mode: TelemetryBreakdownMode
): TelemetryRow[] {
	if (mode === 'person') return telemetryPersonRows(report);
	if (mode === 'day') return telemetryDayRows(report, scope);

	return telemetryRepoRows(report, scope);
}

function sumFoldedTotals(rows: readonly TelemetryRow[]): TelemetryTotals | null {
	const totals = rows.map((row) => row.totals);

	if (totals.some((item) => item === null)) return null;

	const list = totals.filter((item): item is TelemetryTotals => item !== null);
	const add = (pick: (item: TelemetryTotals) => number) => list.reduce((sum, item) => sum + pick(item), 0);
	const reviews = add((item) => item.reviews);
	const reviewTokens = add((item) => item.reviewTokens);

	return {
		prsReviewed: add((item) => item.prsReviewed),
		prsMerged: add((item) => item.prsMerged),
		reviews,
		autoReviews: add((item) => item.autoReviews),
		findings: add((item) => item.findings),
		highFindings: add((item) => item.highFindings),
		mediumFindings: add((item) => item.mediumFindings),
		lowFindings: add((item) => item.lowFindings),
		findingsAccepted: add((item) => item.findingsAccepted),
		findingsDismissed: add((item) => item.findingsDismissed),
		findingsBlocking: add((item) => item.findingsBlocking),
		findingsResolved: add((item) => item.findingsResolved),
		findingsPosted: add((item) => item.findingsPosted),
		reviewTokens,
		avgTokensPerReview: reviews === 0 ? null : Math.round(reviewTokens / reviews)
	};
}

/** Rows beside the daily chart, folding grey entries past the fifth into one `others` row. */
export function telemetryRailRows(report: TelemetryReport, scope: TelemetryScope): TelemetryRow[] {
	const rows = scope.person ? telemetryRepoRows(report, scope) : telemetryPersonRows(report);
	const folded = rows.filter((row) => row.color === OTHERS_COLOR);

	if (folded.length <= 1) return rows;

	const totals = sumFoldedTotals(folded);
	const prsReviewed = folded.reduce((sum, row) => sum + row.prsReviewed, 0);
	const label = scope.person ? moreReposLabel(folded.length) : othersLabel(folded.length);

	return [
		...rows.filter((row) => row.color !== OTHERS_COLOR),
		{
			key: OTHERS_ID,
			name: label,
			lead: { kind: 'none' },
			prsReviewed,
			prsMerged: folded.reduce((sum, row) => sum + row.prsMerged, 0),
			findingsAccepted: folded.reduce((sum, row) => sum + row.findingsAccepted, 0),
			findingsBlocking: folded.reduce((sum, row) => sum + row.findingsBlocking, 0),
			findingsDismissed: folded.reduce((sum, row) => sum + row.findingsDismissed, 0),
			showsDetailColumns: true,
			avgTokensPerReview: totals?.avgTokensPerReview ?? null,
			showsAvgTokens: true,
			share: folded.reduce((sum, row) => sum + row.share, 0),
			color: OTHERS_COLOR,
			personId: null,
			parts: [{ id: OTHERS_ID, label, color: OTHERS_COLOR, value: Math.max(1, prsReviewed) }],
			totals
		}
	];
}

/** Tooltip summary and detailed breakdown for one telemetry row. */
export function telemetryRowTip(row: TelemetryRow): RowTip {
	const partTotal = row.parts.reduce((sum, part) => sum + part.value, 0);

	const rows: ChartTipRow[] =
		row.parts.length > 1 && partTotal > 0
			? row.parts.map((part) => ({
					id: part.id,
					label: part.label,
					color: part.color,
					value: formatWhole(part.value),
					detail: formatShare(part.value / partTotal)
				}))
			: [];

	if (!row.totals) {
		return {
			heading: row.name,
			value: `${formatWhole(row.prsReviewed)} ${row.prsReviewed === 1 ? 'PR' : 'PRs'}`,
			rows,
			details: []
		};
	}

	const { totals } = row;
	const acceptedRate = acceptanceRate(totals);
	const autoShare = autoReviewShare(totals);

	const details: ChartTipRow[] = [
		{ id: 'reviews', label: 'Reviews', value: formatWhole(totals.reviews) },
		{
			id: 'auto-reviews',
			label: 'Auto reviews',
			value: formatWhole(totals.autoReviews),
			detail: autoShare === null ? undefined : formatShare(autoShare)
		},
		{ id: 'raised', label: 'Findings raised', value: formatWhole(totals.findings) },
		{
			id: 'accepted',
			label: 'Accepted',
			value: formatWhole(totals.findingsAccepted),
			detail: acceptedRate === null ? undefined : formatShare(acceptedRate)
		},
		{ id: 'blocking', label: 'Blocking', value: formatWhole(totals.findingsBlocking) },
		{ id: 'dismissed', label: 'Dismissed', value: formatWhole(totals.findingsDismissed) },
		{ id: 'resolved', label: 'Fixed on re-review', value: formatWhole(totals.findingsResolved) },
		{ id: 'posted', label: 'Posted to PR', value: formatWhole(totals.findingsPosted) },
		{ id: 'avg-tokens', label: 'Avg tokens / review', value: formatAvgTokens(totals.avgTokensPerReview) },
		{ id: 'review-tokens', label: 'Review tokens', value: formatCompact(totals.reviewTokens) }
	];

	return {
		heading: row.name,
		value: `${formatWhole(row.prsReviewed)} ${row.prsReviewed === 1 ? 'PR' : 'PRs'}`,
		rows,
		details
	};
}
