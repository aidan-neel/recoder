import {
	REVIEW_CANCELLED,
	findingTier,
	type Finding,
	type Repo,
	type RepoOverview,
	type Review
} from '@recoder/shared';
import { pullStates, type PullStateRecord } from '../forge/pulls/pull-states';
import { isWatchedRepo } from '../forge/watch/scope';
import { readAutoReviewSettings } from '../forge/watch/settings';
import { db } from '../store';
import { groupBy, medianOf, utcDay, windowDayKeys } from '../usage/report-shared';
import { reviewDayOf, reviewTimestamp } from './telemetry-report';

/** The repository page looks back this many days. */
const OVERVIEW_DAYS = 30;

/** How many directories and merged pull requests the page lists. */
const HOTSPOT_LIMIT = 5;
const MERGED_LIMIT = 3;

export interface RepoOverviewInput {
	repoId: string;
	days: number;
	/** The moment the window ends: its last day is this moment's UTC day. */
	now: Date;
	reviews: readonly Review[];
	pullStates: readonly PullStateRecord[];
	/** Whether auto review watches the repository now. */
	autoReview: boolean;
}

/** A review of the repository with the day it started on. */
interface DatedReview {
	review: Review;
	day: string;
}

/** A finding with the day the first review that raised it started, and its newest version. */
interface TrackedFinding {
	day: string;
	latest: Finding;
}

/** True for a review a person asked for and did not stop: not a draft session, not a cancelled run. */
function counts(review: Review): boolean {
	if (review.status === 'draft') return false;

	return !(review.status === 'failed' && review.summary === REVIEW_CANCELLED);
}

/** The repository's counted reviews with their start day, oldest first. */
function datedReviews(input: RepoOverviewInput): DatedReview[] {
	return input.reviews
		.filter((review) => review.repoId === input.repoId && counts(review))
		.sort((a, b) => reviewTimestamp(a) - reviewTimestamp(b) || a.id.localeCompare(b.id))
		.flatMap((review) => {
			const day = reviewDayOf(review);

			return day ? [{ review, day }] : [];
		});
}

/**
 * Each finding of one pull request's passed reviews once: re-reviews carry a finding under the same id, so it dates
 * from the first review that raised it and reads as the newest one has it. Quieted findings are left out.
 */
function pullFindings(reviews: readonly DatedReview[]): TrackedFinding[] {
	const tracked = new Map<string, TrackedFinding>();

	for (const { review, day } of reviews) {
		if (review.status !== 'passed') continue;

		for (const finding of review.findings) {
			tracked.set(finding.id, { day: tracked.get(finding.id)?.day ?? day, latest: finding });
		}
	}

	return [...tracked.values()].filter(({ latest }) => !latest.topic?.quieted);
}

/** True when a finding is a bug rather than a suggestion. */
function isBug(finding: Finding): boolean {
	return findingTier(finding) !== 'fyi' && finding.kind !== 'quality';
}

/** True when a passed review holds a bug feedback did not quiet. */
function foundBug(review: Review): boolean {
	return review.status === 'passed' && review.findings.some((finding) => isBug(finding) && !finding.topic?.quieted);
}

/** The directory a file sits in, ending in `/`; `/` for a file at the root. */
function directoryOf(file: string): string {
	const slash = file.lastIndexOf('/');

	return slash === -1 ? '/' : file.slice(0, slash + 1);
}

/** The directories holding the most bugs, most first, then by path. */
function hotspotsOf(findings: readonly TrackedFinding[]): RepoOverview['hotspots'] {
	const bugs = findings.filter(({ latest }) => isBug(latest) && latest.file);

	return [...groupBy(bugs, ({ latest }) => directoryOf(latest.file))]
		.map(([path, items]) => ({ path, findings: items.length }))
		.sort((a, b) => b.findings - a.findings || a.path.localeCompare(b.path))
		.slice(0, HOTSPOT_LIMIT);
}

/** How long a review took, from its start to its last update; null when its times do not read. */
function durationOf(review: Review): number | null {
	const took = Date.parse(review.updatedAt) - reviewTimestamp(review);

	return Number.isFinite(took) && took >= 0 ? took : null;
}

/** When a merged pull request merged, as an ISO time. */
function mergedAtOf(record: PullStateRecord): string {
	return record.mergedAt ?? record.checkedAt;
}

/** The newest merged pull requests that had a review, with what their reviews found and a person accepted. */
function mergedOf(
	merges: readonly PullStateRecord[],
	byPull: ReadonlyMap<string, DatedReview[]>
): RepoOverview['merged'] {
	return merges
		.filter((record) => byPull.has(String(record.number)))
		.sort((a, b) => Date.parse(mergedAtOf(b)) - Date.parse(mergedAtOf(a)))
		.slice(0, MERGED_LIMIT)
		.map((record) => {
			const reviews = byPull.get(String(record.number)) ?? [];
			const newest = reviews[reviews.length - 1]?.review;
			const fixed = pullFindings(reviews).filter(({ latest }) => latest.decision?.state === 'accepted').length;

			return { number: record.number, title: newest?.prTitle ?? '', mergedAt: mergedAtOf(record), fixed };
		});
}

/** What the repository page shows over the window ending on `now`. Pure: needs no storage or clock. */
export function buildRepoOverview(input: RepoOverviewInput): RepoOverview {
	const window = windowDayKeys(input.now, input.days);
	const inWindow = new Set(window);
	const reviews = datedReviews(input);
	const recent = reviews.filter(({ day }) => inWindow.has(day));
	const byPull = groupBy(reviews, ({ review }) => String(review.prNumber));
	const reviewedPulls = new Set(recent.map(({ review }) => review.prNumber));
	const raised = [...byPull.values()].flatMap(pullFindings).filter(({ day }) => inWindow.has(day));
	const byDay = groupBy(recent, ({ day }) => day);

	const merges = input.pullStates.filter((record) => record.repoId === input.repoId && record.state === 'merged');

	const mergedInWindow = merges.filter((record) => {
		const day = utcDay(mergedAtOf(record));

		return day !== null && inWindow.has(day) && reviewedPulls.has(record.number);
	});

	return {
		repoId: input.repoId,
		days: input.days,
		autoReview: input.autoReview,
		reviewedPulls: reviewedPulls.size,
		mergedPulls: mergedInWindow.length,
		findings: {
			raised: raised.length,
			accepted: raised.filter(({ latest }) => latest.decision?.state === 'accepted').length,
			dismissed: raised.filter(({ latest }) => latest.decision?.state === 'dismissed').length
		},
		typicalReviewMs: medianOf(
			recent.flatMap(({ review }) => {
				const took = review.status === 'passed' ? durationOf(review) : null;

				return took === null ? [] : [took];
			})
		),
		daily: window.map((day) => {
			const started = byDay.get(day) ?? [];

			return { day, reviews: started.length, withBugs: started.filter(({ review }) => foundBug(review)).length };
		}),
		hotspots: hotspotsOf(raised),
		merged: mergedOf(merges, byPull)
	};
}

/** Whether auto review is on and its watcher checks `repo`. */
async function watchesRepo(repo: Repo): Promise<boolean> {
	const settings = readAutoReviewSettings();

	return settings.enabled && isWatchedRepo(repo, settings);
}

/**
 * The repository page's figures for `repo` over the last thirty days, from stored reviews and pull request states, and
 * whether auto review watches it.
 */
export async function loadRepoOverview(repo: Repo, now = new Date()): Promise<RepoOverview> {
	const [reviews, states, autoReview] = await Promise.all([db.reviews.list(), pullStates.list(), watchesRepo(repo)]);

	return buildRepoOverview({ repoId: repo.id, days: OVERVIEW_DAYS, now, reviews, pullStates: states, autoReview });
}
