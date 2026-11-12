import type { AutoReviewReason } from './auto-review';
import type { ReviewContext } from './context';
import type { Finding } from './findings';
import type { ObligationReport } from './obligations';
import type { BriefQuestionReport } from './questions';
import type { Provider } from './repo';

export type ReviewStatus = 'draft' | 'queued' | 'running' | 'passed' | 'failed';

export const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'queued', 'running', 'passed', 'failed'];

/** The failure message of a review the developer stopped, so the UI can say it stopped rather than failed. */
export const REVIEW_CANCELLED = 'Review cancelled.';

/** Where a candidate left the review: a validation check, a person's earlier dismissal, or a verifier's refutation or intent cover. */
export type DropStage = 'location' | 'evidence' | 'category' | 'severity' | 'dismissed' | 'refuted' | 'covered';

/** One changed unit as the review brief read it: in full, from a clipped diff, or not at all, with the reason. */
export interface ReviewBriefUnit {
	id: string;
	status: 'included' | 'partial' | 'omitted';
	reason?: string;
}

/**
 * How many candidates a finished review raised and where each one went, so an
 * eval can see which stage loses findings, and how much of the change the
 * brief those candidates were raised against had read.
 */
export interface ReviewFunnel {
	/** Every candidate a reviewer, subagent or detector reported. */
	raised: number;
	/** Candidates dropped, by the stage that dropped them. */
	dropped: Record<DropStage, number>;
	/** Candidates no verifier could settle, hidden from the findings. */
	unproven: number;
	/** Candidates verified, before reports of one bug merge. */
	verified: number;
	/** Bugs shown unverified because no code could run in the review, before merging; absent when none were. */
	notRun?: number;
	/** Findings shown after merging. */
	shown: number;
	/** Every changed unit the brief read or left out; absent without a brief and on reviews older than recording it. */
	brief?: { complete: boolean; units: ReviewBriefUnit[] };
}

/** Recoder's one summary comment on the pull request, which it edits as the review runs and finishes. */
export interface ReviewPullComment {
	/** `posting` while a write is in flight or the review still runs; `failed` holds the forge's reason in `error`. */
	state: 'posting' | 'posted' | 'failed';
	/** The forge's comment (GitHub) or note (GitLab) id, once one exists. */
	id?: string;
	url?: string;
	error?: string;
	updatedAt: string;
}

/** A finding posted to the pull request: on its diff line when the forge took it there, else as a plain comment. */
export interface ReviewFindingComment {
	id: string;
	url: string;
	inline: boolean;
}

/** A finding an earlier review of the pull request reported, closed because new evidence shows it fixed. */
export interface ResolvedFinding {
	finding: Finding;
	/** What showed the fix: the command that now passes, or the trace that no longer reaches it. */
	reason: string;
	/** The head commit of the review that confirmed the fix. */
	resolvedAtSha: string;
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
	/** Findings of the review before this one that this review's evidence shows fixed. */
	resolved?: ResolvedFinding[];
	/** Where a finished review's candidates went; absent on reviews older than counting them. */
	funnel?: ReviewFunnel;
	/** What each reviewer received, read and cited, and what bounds left out; absent on reviews older than recording it. */
	context?: ReviewContext;
	/** Obligations derived from risky changes and how each investigation ended; absent unless `RECODER_OBLIGATIONS` was on. */
	obligations?: ObligationReport;
	/** The brief's open questions and how the review settled each; absent when the brief had none. */
	questions?: BriefQuestionReport;
	/** CommandRun ids produced by the review pipeline, in order. */
	runs: string[];
	/** Where the PR data came from: live provider fetch or offline stub. */
	source: Provider | 'stub';
	prTitle: string | null;
	prUrl: string | null;
	/** Set when a forge webhook or the auto-review watcher queued the review: nobody is watching it. */
	trigger?: 'webhook' | 'auto';
	/** Why the watcher or a webhook started it, and where on the pull request to answer. */
	autoTrigger?: {
		reason: AutoReviewReason;
		/** Who mentioned Recoder. */
		by?: string;
		/** The mentioning comment, so the reply lands in its thread. */
		noteId?: string;
		discussionId?: string;
	};
	/** False runs every baseline check again instead of reusing an earlier review's result; for a suspected flaky suite. */
	baselineCache?: false;
	/** Present once someone asked Recoder to comment on the pull request. */
	pullComment?: ReviewPullComment;
	/** Findings posted to the pull request, by finding id, so posting again edits them. */
	findingComments?: Record<string, ReviewFindingComment>;
	/** The forge review of verified findings (summary plus inline comments) Recoder submitted once the review finished. */
	findingsReview?: ReviewPullComment;
	/**
	 * Fingerprints of the findings that review's summary showed in full rather
	 * than on a line, so a later review of the pull request does not show an
	 * unchanged one again.
	 */
	summarizedFindings?: string[];
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
	/** True posts a summary comment on the pull request and keeps it current as the review runs. */
	postComment?: boolean;
	/** The developer's brief ("focus on the auth changes"); a started review runs with it. */
	instructions?: string;
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
