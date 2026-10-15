import type { Finding, PullRequest, Review } from '@recoder/shared';
import { queueEntry, type QueueEntry } from '../queue/queue';
import { readDecisions } from '../review/saved-decisions';
import { SAMPLE_PULL, SAMPLE_REVIEW } from './sample-review';

const API = { id: 'sample-repo', name: 'acme/api' };
const WEB = { id: 'sample-web', name: 'acme/web' };

function pull(
	number: number,
	title: string,
	author: string,
	hoursAgo: number,
	size: [number, number, number]
): PullRequest {
	return {
		number,
		title,
		url: `https://github.com/acme/api/pull/${number}`,
		author,
		base: 'main',
		headRef: `agent/pr-${number}`,
		headSha: `sha${number}`,
		additions: size[0],
		deletions: size[1],
		changedFiles: size[2],
		createdAt: new Date(Date.parse('2026-10-13T10:00:00Z') - hoursAgo * 3_600_000).toISOString()
	};
}

function review(
	prNumber: number,
	status: Review['status'],
	findings: Finding['severity'][],
	headSha = `sha${prNumber}`
): Review {
	return {
		...SAMPLE_REVIEW,
		id: `sample-${prNumber}`,
		prNumber,
		headSha,
		status,
		questions: undefined,
		findings: findings.map((severity, index) => ({
			id: `${prNumber}-${index}`,
			file: 'src/a.ts',
			severity,
			message: 'Sample finding.'
		}))
	};
}

/** A believable morning queue around the sample review, one entry per state. */
export function sampleQueue(): QueueEntry[] {
	return [
		queueEntry(API, SAMPLE_PULL, SAMPLE_REVIEW, readDecisions(SAMPLE_REVIEW.id, SAMPLE_REVIEW.headSha)),
		queueEntry(
			API,
			pull(211, 'Move session storage from Redis to Postgres', 'codex[bot]', 1, [418, 233, 14]),
			review(211, 'running', []),
			{}
		),
		queueEntry(
			WEB,
			pull(207, 'Retry failed webhook deliveries with backoff', 'claude[bot]', 3, [96, 12, 4]),
			review(207, 'passed', ['warning']),
			{}
		),
		queueEntry(WEB, pull(205, 'Add CSV export to the billing page', 'claude[bot]', 5, [143, 8, 6]), null, {}),
		queueEntry(
			API,
			pull(198, 'Cache project lists per organization', 'devin[bot]', 26, [61, 19, 3]),
			review(198, 'passed', ['error'], 'old'),
			{}
		),
		queueEntry(
			WEB,
			pull(202, 'Debounce search requests in the command bar', 'claude[bot]', 7, [38, 11, 2]),
			review(202, 'passed', ['warning', 'info']),
			{
				'202-0': { state: 'sent', note: '', at: 0 },
				'202-1': { state: 'accepted', note: '', at: 0 }
			}
		),
		queueEntry(
			API,
			pull(209, 'Bump eslint to v10 and fix new lint errors', 'renovate[bot]', 9, [57, 49, 11]),
			review(209, 'passed', []),
			{}
		)
	];
}

/** Live task counts for the sample's running review. */
export const SAMPLE_PROGRESS = { 'sample-211': { tasksDone: 4, tasksTotal: 7 } };
