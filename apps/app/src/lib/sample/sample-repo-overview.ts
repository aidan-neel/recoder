import type { RepoOverview } from '@recoder/shared';

import { ApiError } from '../api/http';
import type { SampleSeed } from './sample-pulls';

const DAY_MS = 86_400_000;

/** The window the server reads, in days. */
const DAYS = 30;

/** How many merged pull requests the server lists. */
const MERGED_ROWS = 3;

/** The shape of one sample repository's month: how busy it is and where its bugs land. */
interface MonthSpec {
	/** Reviews on a busy weekday. */
	peak: number;
	/** Of the reviews, the share that found a bug. */
	bugRate: number;
	/** Bugs raised per review that found any. */
	bugsPerReview: number;
	typicalReviewMs: number;
	hotspots: readonly string[];
	/** Whether auto review watches the repository. */
	autoReview: boolean;
}

const MONTHS: Record<string, MonthSpec> = {
	'sample-api': {
		peak: 5,
		bugRate: 0.42,
		bugsPerReview: 2.4,
		typicalReviewMs: 400_000,
		hotspots: ['src/billing/', 'src/webhooks/', 'src/auth/session/', 'src/exports/', 'src/db/migrations/'],
		autoReview: true
	},
	'sample-web': {
		peak: 3,
		bugRate: 0.3,
		bugsPerReview: 1.6,
		typicalReviewMs: 251_000,
		hotspots: ['src/routes/settings/', 'src/lib/charts/', 'src/components/forms/'],
		autoReview: false
	}
};

/** A number in [0, 1) that is the same for the same seed, so the sample draws the same month on every load. */
function noise(seed: number): number {
	const wave = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;

	return wave - Math.floor(wave);
}

/** The UTC day `back` days before `now`, as `YYYY-MM-DD`. */
function dayKey(now: number, back: number): string {
	return new Date(now - back * DAY_MS).toISOString().slice(0, 10);
}

/** One sample day: fewer reviews at the weekend, a quiet day now and then. */
function sampleDay(spec: MonthSpec, now: number, back: number): RepoOverview['daily'][number] {
	const day = dayKey(now, back);
	const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
	const weekend = weekday === 0 || weekday === 6;
	const reviews = Math.round(noise(back) * spec.peak * (weekend ? 0.3 : 1));
	const withBugs = Math.round(reviews * spec.bugRate * (0.4 + noise(back + 99)));

	return { day, reviews, withBugs };
}

/** A month of a sample repository, shaped like the server's answer. */
function sampleMonth(repoId: string, spec: MonthSpec, now: number): RepoOverview {
	const daily = Array.from({ length: DAYS }, (_, index) => sampleDay(spec, now, DAYS - 1 - index));
	const reviews = daily.reduce((sum, day) => sum + day.reviews, 0);
	const withBugs = daily.reduce((sum, day) => sum + day.withBugs, 0);
	const raised = Math.round(withBugs * spec.bugsPerReview);
	const reviewedPulls = Math.round(reviews * 0.85);
	const weights = spec.hotspots.map((_, index) => 1 / (index + 1.4));
	const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

	return {
		repoId,
		days: DAYS,
		autoReview: spec.autoReview,
		reviewedPulls,
		mergedPulls: Math.round(reviewedPulls * 0.88),
		findings: { raised, accepted: Math.round(raised * 0.78), dismissed: Math.round(raised * 0.12) },
		typicalReviewMs: spec.typicalReviewMs,
		daily,
		hotspots: spec.hotspots.map((path, index) => ({
			path,
			findings: Math.max(1, Math.round((raised * 0.8 * weights[index]) / weightTotal))
		})),
		merged: []
	};
}

/** The sample's merged pull requests of the repository that had a review, newest first, with the findings accepted on them. */
function mergedOf(seed: SampleSeed, repoId: string): RepoOverview['merged'] {
	return seed.pulls
		.filter((item) => item.repoId === repoId && item.status.state === 'merged')
		.map((item) => ({
			item,
			reviews: seed.reviews.filter((review) => review.repoId === repoId && review.prNumber === item.pull.number)
		}))
		.filter(({ reviews }) => reviews.length > 0)
		.sort((a, b) => Date.parse(b.item.status.updatedAt) - Date.parse(a.item.status.updatedAt))
		.slice(0, MERGED_ROWS)
		.map(({ item, reviews }) => ({
			number: item.pull.number,
			title: item.pull.title,
			mergedAt: item.status.updatedAt,
			fixed: new Set(
				reviews.flatMap((review) =>
					review.findings.filter((finding) => finding.decision?.state === 'accepted').map((finding) => finding.id)
				)
			).size
		}));
}

/** A tracked repository with nothing reviewed yet: a repository added to the sample. */
function quietMonth(repoId: string, now: number): RepoOverview {
	return {
		repoId,
		days: DAYS,
		autoReview: false,
		reviewedPulls: 0,
		mergedPulls: 0,
		findings: { raised: 0, accepted: 0, dismissed: 0 },
		typicalReviewMs: null,
		daily: Array.from({ length: DAYS }, (_, index) => ({
			day: dayKey(now, DAYS - 1 - index),
			reviews: 0,
			withBugs: 0
		})),
		hotspots: [],
		merged: []
	};
}

/**
 * The sample's answer to the repository page, as the server answers: a 404 for a repository it does not track. The
 * month is drawn; what merged is the sample's own merged pull requests, so each row opens its page.
 */
export function sampleRepoOverview(seed: SampleSeed, repoId: string, now = Date.now()): RepoOverview {
	if (!seed.repos.some((repo) => repo.id === repoId)) throw new ApiError('repo not found', 404);

	const spec = MONTHS[repoId];
	const month = spec ? sampleMonth(repoId, spec, now) : quietMonth(repoId, now);

	return { ...month, merged: mergedOf(seed, repoId) };
}
