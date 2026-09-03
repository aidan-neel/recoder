/**
 * @recoder/shared — API contract between apps/web and apps/server.
 * Import types only; this package ships source (no build step).
 */

export type Provider = 'github';

export type ReviewStatus = 'queued' | 'running' | 'passed' | 'failed';

export type FindingSeverity = 'info' | 'warning' | 'error';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'killed' | 'rejected';

export interface Repo {
	id: string;
	name: string;
	url: string;
	provider: Provider;
	defaultBranch: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateRepoInput {
	name: string;
	url: string;
	provider?: Provider;
	defaultBranch?: string;
}

export interface Finding {
	id: string;
	file: string;
	line?: number;
	severity: FindingSeverity;
	message: string;
	suggestion?: string;
}

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
	createdAt: string;
	updatedAt: string;
}

export interface CreateReviewInput {
	repoId: string;
	prNumber: number;
	headSha?: string;
}

export interface CommandRun {
	id: string;
	label: string | null;
	command: string;
	args: string[];
	status: RunStatus;
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

export const REVIEW_STATUSES: ReviewStatus[] = ['queued', 'running', 'passed', 'failed'];
