import { findingTone, type Repo, type RepoOverview, type ReviewListItem } from '@recoder/shared';

import { isOpenFinding } from '../api/reviews';
import { forgeLabel } from '../connections/forges';
import { needsReview } from '../pulls/pull-rows';
import type { PullRow, PullRowStatus } from '../pulls/types';
import type { RowEntry } from '../pulls/use-rows';
import { formatReportDay } from '../usage/report-shared';
import { formatDuration, plural, pullTitle } from '../shell/format';
import { pullHref } from '../shell/routes';
import type { HotspotRow, MergedRow, RepoFacts, RepoFigure, RepoPageData, ReviewChart } from './types';

/** How many open pull requests "Needs you" lists. */
const NEEDS_YOU_ROWS = 5;

/**
 * How soon a row needs a person, lowest first. A pull request with a high bug comes before every row here; then
 * other open bugs, no review at the head, what the forge blocks, a review that runs, and what can merge.
 */
const URGENCY: Record<PullRowStatus['kind'], number> = {
	bugs: 1,
	'not-reviewed': 2,
	outdated: 2,
	'review-failed': 2,
	conflicts: 3,
	'checks-failing': 3,
	reviewing: 4,
	ready: 5,
	reviewed: 6,
	draft: 7
};

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The open findings of a review that are bugs, not suggestions. */
function openBugs(review: ReviewListItem | null): ReviewListItem['findings'] {
	return (review?.findings ?? []).filter((finding) => isOpenFinding(finding) && finding.kind !== 'quality');
}

/** How many of a row's open bugs are high; only a row that shows its bugs counts them. */
function highBugs({ listed, row }: RowEntry): number {
	if (row.status.kind !== 'bugs') return 0;

	return openBugs(listed.review).filter((finding) => findingTone(finding.severity) === 'high').length;
}

/** The rows most urgent first; rows equally urgent keep their order, newest activity first. */
function byUrgency(entries: readonly RowEntry[]): PullRow[] {
	const rank = (entry: RowEntry) => (highBugs(entry) > 0 ? 0 : URGENCY[entry.row.status.kind]);

	return [...entries]
		.sort((a, b) => rank(a) - rank(b))
		.slice(0, NEEDS_YOU_ROWS)
		.map((entry) => entry.row);
}

/** The header's facts: the name split from its owner, the forge to open it on, and since when it is tracked. */
function repoFacts(repo: Repo): RepoFacts {
	const parts = repo.name.split('/');
	const name = parts.pop() ?? repo.name;
	const { provider } = repo;

	return {
		id: repo.id,
		owner: parts.length > 0 ? parts.join('/') : null,
		name,
		provider,
		forge: provider === 'local' ? null : { url: repo.url, label: forgeLabel(provider) },
		defaultBranch: repo.defaultBranch,
		tracked: `Tracked since ${monthDay.format(new Date(repo.createdAt))}`
	};
}

/** `accepted` as a whole percentage of `raised`; a dash with nothing raised. */
function percentOf(accepted: number, raised: number): string {
	return raised === 0 ? '—' : `${Math.round((accepted / raised) * 100)}%`;
}

/** The five figures: open pull requests and bugs from the list, the rest from the overview. */
function figuresOf(entries: readonly RowEntry[], more: boolean, overview: RepoOverview): RepoFigure[] {
	const notReviewed = entries.filter((entry) => needsReview(entry.listed)).length;
	const bugs = entries.reduce((sum, { row }) => sum + (row.status.kind === 'bugs' ? row.status.bugs : 0), 0);
	const high = entries.reduce((sum, entry) => sum + highBugs(entry), 0);
	const { raised, accepted } = overview.findings;

	return [
		{
			id: 'open',
			label: 'Open pull requests',
			value: `${entries.length}${more ? '+' : ''}`,
			detail: notReviewed > 0 ? `${notReviewed} not reviewed` : null,
			tone: null
		},
		{ id: 'bugs', label: 'Open bugs', value: String(bugs), detail: high > 0 ? `${high} high` : null, tone: 'high' },
		{
			id: 'merged',
			label: `Merged, ${overview.days} days`,
			value: String(overview.mergedPulls),
			detail: overview.reviewedPulls > 0 ? `of ${overview.reviewedPulls} reviewed` : null,
			tone: null
		},
		{
			id: 'accepted',
			label: 'Findings accepted',
			value: percentOf(accepted, raised),
			detail: raised > 0 ? `${accepted} of ${raised}` : null,
			tone: null
		},
		{
			id: 'typical',
			label: 'Typical review',
			value: overview.typicalReviewMs === null ? '—' : formatDuration(overview.typicalReviewMs),
			detail: null,
			tone: null
		}
	];
}

/** A bar a day, each as a share of the busiest day, so the tallest bar fills the chart. */
function chartOf(overview: RepoOverview): ReviewChart {
	const busiest = Math.max(0, ...overview.daily.map((day) => day.reviews));
	const reviews = overview.daily.reduce((sum, day) => sum + day.reviews, 0);
	const withBugs = overview.daily.reduce((sum, day) => sum + day.withBugs, 0);
	const [first] = overview.daily;

	return {
		title: `Reviews, ${overview.days} days`,
		bars: overview.daily.map((day) => ({
			...day,
			label: formatReportDay(day.day),
			height: busiest === 0 ? 0 : day.reviews / busiest,
			bugShare: day.reviews === 0 ? 0 : day.withBugs / day.reviews
		})),
		first: first ? monthDay.format(new Date(`${first.day}T00:00:00Z`)) : '',
		last: 'Today',
		empty: reviews === 0 ? `No reviews in ${overview.days} days.` : null,
		summary: `${plural(reviews, 'review')} in ${overview.days} days, ${withBugs} found a bug`
	};
}

/** The directories where bugs land, each with its share of the first. */
function hotspotsOf(overview: RepoOverview): HotspotRow[] {
	const most = overview.hotspots[0]?.findings ?? 0;

	return overview.hotspots.map((spot) => ({ ...spot, share: most === 0 ? 0 : spot.findings / most }));
}

/** The pull requests that merged after a review, with what their reviews fixed. */
function mergedOf(overview: RepoOverview, base: string): MergedRow[] {
	return overview.merged.map((pull) => ({
		key: String(pull.number),
		number: pull.number,
		title: pullTitle(pull.title, pull.number),
		mergedAt: pull.mergedAt,
		outcome: pull.fixed > 0 ? `${pull.fixed} fixed` : 'Clean',
		href: pullHref(base, overview.repoId, pull.number)
	}));
}

interface RepoPageInput {
	repo: Repo;
	/** The repository's open pull requests, newest activity first. */
	entries: readonly RowEntry[];
	/** True when the repository has more open pull requests than `entries` holds. */
	more: boolean;
	overview: RepoOverview;
	base: string;
}

/** What the page shows, from the repository, its open pull requests and its overview. */
export function repoPageData({ repo, entries, more, overview, base }: RepoPageInput): RepoPageData {
	const count = `${entries.length}${more ? '+' : ''}`;

	return {
		repo: repoFacts(repo),
		figures: figuresOf(entries, more, overview),
		needsYou: byUrgency(entries),
		allPullsLabel: entries.length === 1 && !more ? '1 pull request' : `All ${count} pull requests`,
		merged: mergedOf(overview, base),
		chart: chartOf(overview),
		window: `${overview.days} days`,
		hotspots: hotspotsOf(overview)
	};
}
