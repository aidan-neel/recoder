import type { FindingSeverity } from './findings';

/**
 * Auto-review: Recoder watches tracked repositories and starts reviews on its
 * own, when someone mentions it in a pull/merge request comment, when a pull
 * request opens, or when one it reviewed gets new commits.
 */

/** Why an automatic review started. */
export type AutoReviewReason = 'mention' | 'opened' | 'pushed';

/** The mention handle a fresh install listens for. */
export const DEFAULT_MENTION_HANDLE = '@recoder';

/** Poll intervals the settings offer, in seconds. */
export const AUTO_REVIEW_INTERVALS = [60, 120, 300, 600, 1800] as const;

export type AutoReviewInterval = (typeof AUTO_REVIEW_INTERVALS)[number];

/** The most inline comments one findings review may hold; the settings cap `maxInlineComments` here. */
export const MAX_INLINE_COMMENTS = 100;

/** The lowest severity that fails Recoder's check on the pull request's head commit, or `off` for no check. */
export type CheckThreshold = FindingSeverity | 'off';

export interface AutoReviewSettings {
	/** The watcher runs at all. Off, nothing below happens. */
	enabled: boolean;
	/** How often each tracked repository is checked. */
	intervalSeconds: AutoReviewInterval;
	/** Review when a comment mentions `mentionHandle`; the rest of the comment becomes the review's instructions. */
	onMention: boolean;
	/** The word that summons Recoder in a comment, `@recoder` by default. */
	mentionHandle: string;
	/** Review every pull request when it opens. */
	onOpened: boolean;
	/** Review again when a pull request Recoder reviewed automatically gets new commits. */
	onPushed: boolean;
	/** Leave draft (WIP) pull requests alone unless someone mentions Recoder. */
	skipDrafts: boolean;
	/** Post a comment on the pull request when the review finishes, and react to the mention when it starts. */
	postResults: boolean;
	/** Tracked repositories the watcher leaves alone. New repositories are watched. */
	excludedRepoIds: string[];
	/** Globs of repository paths (`docs/**`, `**\/*.md`) whose findings are never posted and never fail the check. */
	ignoredPaths: string[];
	/** The most findings posted as inline comments in one review, worst first; the rest are listed in its summary. */
	maxInlineComments: number;
	/** Verified findings at or above this severity fail the commit check Recoder sets; `off` sets none. */
	checkThreshold: CheckThreshold;
}

export const DEFAULT_AUTO_REVIEW_SETTINGS: AutoReviewSettings = {
	enabled: false,
	intervalSeconds: 120,
	onMention: true,
	mentionHandle: DEFAULT_MENTION_HANDLE,
	onOpened: false,
	onPushed: false,
	skipDrafts: true,
	postResults: true,
	excludedRepoIds: [],
	ignoredPaths: [],
	maxInlineComments: 25,
	checkThreshold: 'error'
};

/** One review the watcher started. */
export interface AutoReviewEvent {
	repoId: string;
	prNumber: number;
	reviewId: string;
	reason: AutoReviewReason;
	/** Who mentioned Recoder, for a mention. */
	by?: string;
	at: string;
}

/** How the watcher is doing, for Settings. */
export interface AutoReviewStatus {
	/** True while the watcher's timer is running. */
	running: boolean;
	/** Repositories it checks each round. */
	watching: number;
	lastCheckAt: string | null;
	nextCheckAt: string | null;
	/** The last round's failures, one per repository that failed. */
	errors: { repoId: string; message: string }[];
	/** The latest reviews it started, newest first. */
	recent: AutoReviewEvent[];
}

/** `GET` and `PUT /api/settings/auto-review` answer with both. */
export interface AutoReviewPayload {
	settings: AutoReviewSettings;
	status: AutoReviewStatus;
	/** Where GitLab and GitHub webhooks can point instead of polling, relative to the server. */
	webhookPaths: { gitlab: string; github: string };
}
