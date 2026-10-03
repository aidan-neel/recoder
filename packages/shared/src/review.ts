import type { Finding } from './findings';

export type ReviewStatus = 'draft' | 'queued' | 'running' | 'passed' | 'failed';

export const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'queued', 'running', 'passed', 'failed'];

/** The failure message of a review the developer stopped, so the UI can say it stopped rather than failed. */
export const REVIEW_CANCELLED = 'Review cancelled.';

export interface Review {
	id: string;
	repoId: string;
	prNumber: number;
	headSha: string;
	status: ReviewStatus;
	summary: string | null;
	findings: Finding[];
	/** CommandRun ids produced by the review pipeline, in order. */
	runs: string[];
	/** Where the PR data came from: live provider fetch or offline stub. */
	source: 'github' | 'gitlab' | 'stub';
	prTitle: string | null;
	prUrl: string | null;
	/** Set when a forge webhook queued the review: nobody is watching it. */
	trigger?: 'webhook';
	/** When analysis began; draft sessions may exist before a review is requested. */
	startedAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateReviewInput {
	repoId: string;
	prNumber: number;
	headSha?: string;
	/** False opens an empty chat session; omitted/true queues an automated review. */
	start?: boolean;
	/** Display metadata from the selected open PR. Refetched before analysis. */
	prTitle?: string;
}

export interface CommandRun {
	id: string;
	label: string | null;
	command: string;
	args: string[];
	status: 'running' | 'succeeded' | 'failed' | 'killed' | 'rejected';
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
	logs: string;
}

export interface HealthResponse {
	ok: true;
	name: string;
	version: string;
	uptimeSeconds: number;
}
