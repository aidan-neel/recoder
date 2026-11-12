import {
	REVIEW_CANCELLED,
	type PrCheck,
	type PullComment,
	type PullCommit,
	type PullRequest,
	type PullStatus,
	type Repo,
	type Review
} from '@recoder/shared';

import { sampleTime } from './sample-clock';
import { SAMPLE_CHECKS, SAMPLE_PULL, SAMPLE_REVIEW } from './sample-review';

/** One open pull request of the sample, with what its forge says about it. */
export interface SamplePull {
	repoId: string;
	pull: PullRequest;
	status: PullStatus;
	checks: PrCheck[];
}

/** Everything the sample starts with. Each sample client gets its own copy to change. */
export interface SampleSeed {
	repos: Repo[];
	pulls: SamplePull[];
	reviews: Review[];
	comments: Record<string, PullComment[]>;
}

const AT = sampleTime('2026-10-13T09:00:00.000Z');

const REPOS: Repo[] = [
	{
		id: 'sample-api',
		name: 'acme/api',
		url: 'https://github.com/acme/api',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: AT,
		updatedAt: AT
	},
	{
		id: 'sample-web',
		name: 'acme/web',
		url: 'https://github.com/acme/web',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: AT,
		updatedAt: AT
	}
];

const PASSED: PrCheck[] = [
	{ name: 'typecheck', state: 'passed', url: null },
	{ name: 'unit tests', state: 'passed', url: null }
];

const FAILING: PrCheck[] = [
	{ name: 'typecheck', state: 'failed', url: null },
	{ name: 'unit tests', state: 'failed', url: null },
	{ name: 'lint', state: 'passed', url: null }
];

/** The tally a forge reports for these checks. */
function tally(checks: PrCheck[]): PullStatus['checks'] {
	return {
		passed: checks.filter((check) => check.state === 'passed' || check.state === 'skipped').length,
		failed: checks.filter((check) => check.state === 'failed').length,
		pending: checks.filter((check) => check.state === 'pending' || check.state === 'running').length
	};
}

interface PullShape {
	repoId: string;
	number: number;
	title: string;
	author: string;
	updatedAt: string;
	status?: Partial<Pick<PullStatus, 'draft' | 'mergeability'>>;
	checks?: PrCheck[];
}

function samplePull(shape: PullShape): SamplePull {
	const repo = REPOS.find((candidate) => candidate.id === shape.repoId) ?? REPOS[0];
	const checks = shape.checks ?? PASSED;

	return {
		repoId: shape.repoId,
		pull: {
			number: shape.number,
			title: shape.title,
			url: `${repo.url}/pull/${shape.number}`,
			author: shape.author,
			base: 'main',
			headRef: `feature/${shape.number}`,
			headSha: `${shape.number}c0ffee`,
			additions: 40 + shape.number,
			deletions: shape.number % 30,
			changedFiles: 2,
			createdAt: shape.updatedAt
		},
		status: {
			state: 'open',
			draft: false,
			mergeability: 'clean',
			updatedAt: shape.updatedAt,
			checks: tally(checks),
			commits: 2,
			...shape.status
		},
		checks
	};
}

/** A review of a sample pull request with no findings: still running, failed, or clean at a head. */
function plainReview(pull: SamplePull, status: Review['status'], headSha = pull.pull.headSha): Review {
	return {
		id: `sample-${pull.pull.number}`,
		repoId: pull.repoId,
		prNumber: pull.pull.number,
		headSha,
		status,
		summary: status === 'failed' ? 'The checkout timed out before the review could read the change.' : null,
		findings: [],
		runs: [],
		source: 'github',
		prTitle: pull.pull.title,
		prUrl: pull.pull.url,
		startedAt: pull.status.updatedAt,
		createdAt: pull.status.updatedAt,
		updatedAt: pull.status.updatedAt
	};
}

const PULLS = {
	rateLimit: { repoId: 'sample-api', pull: SAMPLE_PULL, status: sampleStatus(), checks: SAMPLE_CHECKS },
	exports: samplePull({
		repoId: 'sample-api',
		number: 216,
		title: 'Stream usage exports to S3',
		author: 'maya',
		updatedAt: sampleTime('2026-10-13T10:40:00.000Z')
	}),
	webhooks: samplePull({
		repoId: 'sample-api',
		number: 211,
		title: 'Retry webhook deliveries with backoff',
		author: 'devin-ai[bot]',
		updatedAt: sampleTime('2026-10-13T08:30:00.000Z')
	}),
	settings: samplePull({
		repoId: 'sample-web',
		number: 88,
		title: 'Move settings to the new form kit',
		author: 'jonas',
		updatedAt: sampleTime('2026-10-13T07:55:00.000Z'),
		status: { mergeability: 'conflicts' }
	}),
	charts: samplePull({
		repoId: 'sample-web',
		number: 91,
		title: 'Upgrade the chart library',
		author: 'renovate[bot]',
		updatedAt: sampleTime('2026-10-13T07:20:00.000Z'),
		checks: FAILING
	}),
	darkMode: samplePull({
		repoId: 'sample-web',
		number: 93,
		title: 'Dark mode tokens',
		author: 'ana',
		updatedAt: sampleTime('2026-10-13T06:45:00.000Z'),
		status: { draft: true }
	}),
	audit: samplePull({
		repoId: 'sample-api',
		number: 219,
		title: 'Add an audit log for admin actions',
		author: 'claude[bot]',
		updatedAt: sampleTime('2026-10-13T06:10:00.000Z')
	}),
	datePicker: samplePull({
		repoId: 'sample-web',
		number: 85,
		title: 'Fix the date picker in Safari',
		author: 'ana',
		updatedAt: sampleTime('2026-10-12T17:30:00.000Z')
	}),
	pagination: samplePull({
		repoId: 'sample-api',
		number: 205,
		title: 'Document the pagination headers',
		author: 'maya',
		updatedAt: sampleTime('2026-10-12T15:00:00.000Z')
	}),
	billing: samplePull({
		repoId: 'sample-web',
		number: 80,
		title: 'Lazy-load the billing page',
		author: 'jonas',
		updatedAt: sampleTime('2026-10-12T11:00:00.000Z'),
		status: { mergeability: 'blocked' }
	})
};

function sampleStatus(): PullStatus {
	return {
		state: 'open',
		draft: false,
		mergeability: 'clean',
		updatedAt: SAMPLE_REVIEW.updatedAt,
		checks: tally(SAMPLE_CHECKS),
		commits: 3
	};
}

/** The sample review's summary comment and a reply, so the conversation has something to read. */
const CONVERSATION: PullComment[] = [
	{
		id: 'sample-comment-1',
		kind: 'comment',
		author: { login: 'maya', name: 'Maya', avatarUrl: null },
		body: 'Should anonymous traffic be limited per address instead? Sign-up runs before a tenant exists.',
		createdAt: sampleTime('2026-10-13T09:20:00.000Z'),
		url: null,
		byRecoder: false
	},
	{
		id: 'sample-comment-2',
		kind: 'review',
		author: { login: 'claude[bot]', name: null, avatarUrl: null },
		body: 'Good catch. I will key header-less requests by client address.',
		createdAt: sampleTime('2026-10-13T09:31:00.000Z'),
		url: null,
		verdict: 'commented',
		byRecoder: false
	}
];

/** The commits of a sample pull request, oldest first. */
export function sampleCommits(pull: SamplePull): PullCommit[] {
	const author = { login: pull.pull.author, name: null, avatarUrl: null };
	const titles = ['Start on the change', 'Add tests', 'Address review feedback'].slice(0, pull.status.commits ?? 2);

	return titles.map((title, index) => ({
		sha: `${pull.pull.number}${index}a1b2c3d4`,
		title,
		body: '',
		author,
		authoredAt: new Date(Date.parse(pull.pull.createdAt) + index * 600_000).toISOString(),
		url: null
	}));
}

/** A fresh copy of the sample's repositories, pull requests, reviews and conversations. */
export function sampleSeed(): SampleSeed {
	const reviews: Review[] = [
		structuredClone(SAMPLE_REVIEW),
		plainReview(PULLS.exports, 'running'),
		plainReview(PULLS.webhooks, 'failed'),
		{ ...plainReview(PULLS.audit, 'failed'), summary: REVIEW_CANCELLED },
		plainReview(PULLS.datePicker, 'passed', '85bead'),
		plainReview(PULLS.pagination, 'passed'),
		plainReview(PULLS.billing, 'passed')
	];

	return {
		repos: structuredClone(REPOS),
		pulls: structuredClone(Object.values(PULLS)),
		reviews,
		comments: { [`sample-api#${SAMPLE_PULL.number}`]: structuredClone(CONVERSATION) }
	};
}
