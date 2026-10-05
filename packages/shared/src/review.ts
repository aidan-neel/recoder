import type { Finding } from './findings';
import type { Provider } from './repo';

export type ReviewStatus = 'draft' | 'queued' | 'running' | 'passed' | 'failed';

export const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'queued', 'running', 'passed', 'failed'];

/** The failure message of a review the developer stopped, so the UI can say it stopped rather than failed. */
export const REVIEW_CANCELLED = 'Review cancelled.';

/** Where a candidate left the review: a validation check, a person's earlier dismissal, or a verifier's refutation or intent cover. */
export type DropStage = 'location' | 'evidence' | 'category' | 'severity' | 'dismissed' | 'refuted' | 'covered';

/** How many candidates a finished review raised and where each one went, so an eval can see which stage loses findings. */
export interface ReviewFunnel {
	/** Every candidate a reviewer, subagent or detector reported. */
	raised: number;
	/** Candidates dropped, by the stage that dropped them. */
	dropped: Record<DropStage, number>;
	/** Candidates no verifier could settle, hidden from the findings. */
	unproven: number;
	/** Candidates verified, before reports of one bug merge. */
	verified: number;
	/** Findings shown after merging. */
	shown: number;
}

export interface Review {
	id: string;
	repoId: string;
	prNumber: number;
	headSha: string;
	status: ReviewStatus;
	summary: string | null;
	findings: Finding[];
	/** Candidates a passed review could not prove, kept out of `findings` so the benchmark can score what it hid. */
	unconfirmed?: Finding[];
	/** Where a finished review's candidates went; absent on reviews older than counting them. */
	funnel?: ReviewFunnel;
	/** CommandRun ids produced by the review pipeline, in order. */
	runs: string[];
	/** Where the PR data came from: live provider fetch or offline stub. */
	source: Provider | 'stub';
	prTitle: string | null;
	prUrl: string | null;
	/** Set when a forge webhook queued the review: nobody is watching it. */
	trigger?: 'webhook';
	/** False runs every baseline check again instead of reusing an earlier review's result; for a suspected flaky suite. */
	baselineCache?: false;
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
	/** False skips the baseline check cache for this review. */
	baselineCache?: false;
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
