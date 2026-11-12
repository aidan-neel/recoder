import type { FindingTopic } from './findings';
import type { Provider } from './repo';

/**
 * Where a repository keeps its layer of the owner review guidelines, in
 * precedence order: the first file that exists is the layer, and the others
 * are ignored. `.recoder/REVIEW.md` is the older location, still read for
 * repositories that have it.
 */
export const GUIDELINES_PATHS = ['RECODER.md', '.recoder/REVIEW.md'] as const;

/** Where a new repository layer is written: `RECODER.md` at the repository root. */
export const GUIDELINES_PATH = GUIDELINES_PATHS[0];
export const MAX_GUIDELINES_CHARS = 8000;

/** The longest instruction the server takes for a guidelines draft. */
export const MAX_GUIDELINES_PROMPT_CHARS = 4000;

export interface GlobalGuidelines {
	content: string;
	updatedAt: string | null;
}

export interface GuidelinesOverview {
	global: GlobalGuidelines;
	/** Starter text for an empty editor. */
	template: string;
	maxChars: number;
	/** Where a repository without a guidelines file gets one (`RECODER.md`). */
	path: string;
	repos: { id: string; name: string; provider: Provider }[];
}

/** An open pull/merge request that adds or changes a repo's guidelines. */
export interface PendingGuidelinesChange {
	number: number;
	url: string;
	branch: string;
	/** The file as it is on the pending branch. */
	content: string | null;
}

export interface RepoGuidelines {
	repoId: string;
	/** The file the repository's layer lives in: the one found, else where a new one is written. */
	path: string;
	/** Default branch the active file is read from. */
	ref: string;
	/** Head commit of `ref`. */
	sha: string | null;
	/** The file on the default branch, or null when there is none. */
	content: string | null;
	pending: PendingGuidelinesChange | null;
	/** A token is connected, so Recoder can open a pull request. */
	canPropose: boolean;
}

export interface GuidelinesProposal {
	number: number;
	url: string;
	branch: string;
	/** True when an existing pending change was updated instead of a new one opened. */
	updated: boolean;
}

export interface GuidelinesDraftRequest {
	scope: 'global' | 'repo';
	repoId?: string;
	/** What the owner wants reviewers to care about. */
	prompt: string;
	/** The editor's current text; the draft revises it when present. */
	current?: string;
	include?: {
		/** The repo's AGENTS.md / CLAUDE.md / CONTRIBUTING.md from its default branch. */
		instructions?: boolean;
		/** Findings from this repo's recent reviews. */
		findings?: boolean;
		/** The global guidelines, when drafting a repo layer. */
		global?: boolean;
	};
}

/** Where a learned rule stands: waiting for a person, or decided by one. */
export type LearnedRuleState = 'proposed' | 'approved' | 'rejected';

/**
 * A rule Recoder learned from a repository's people: they kept dismissing one
 * topic's findings, so Recoder proposes quieting that topic there. It applies
 * to later reviews only while `state` is `approved`. Listed by
 * `GET /api/repos/:repoId/learned-rules`, decided by
 * `PUT /api/repos/:repoId/learned-rules/:topicId`.
 */
export interface LearnedRuleProposal {
	repoId: string;
	/** The topic the rule quiets; one proposal per topic in a repository. */
	topic: Pick<FindingTopic, 'id' | 'label'>;
	state: LearnedRuleState;
	/** The topic's dismissed and useful votes when it was last proposed. */
	votes: { dismissed: number; useful: number };
	proposedAt: string;
	/** When a person approved or rejected it. */
	decidedAt?: string;
}

/** The body of `PUT /api/repos/:repoId/learned-rules/:topicId`. */
export interface LearnedRuleDecision {
	state: 'approved' | 'rejected';
}
