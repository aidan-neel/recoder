import type { FailureAction } from '@recoder/shared';

/** Where the newest review of a pull request stands. `none`: never reviewed. `cancelled`: a person stopped it. */
export type RunPhase = 'none' | 'queued' | 'running' | 'paused' | 'passed' | 'failed' | 'cancelled';

/** One step of a review as the progress card lists it. */
export interface RunStage {
	id: 'read' | 'plan' | 'check' | 'write';
	label: string;
	state: 'waiting' | 'active' | 'done';
	/** A count for the active or finished step: `12 of 31`. */
	detail: string | null;
	/** How far the step is, 0 to 1, when it counts its work. */
	share: number | null;
}

/** The review of a pull request while it runs, and the controls that start and stop it. */
export interface RunView {
	phase: RunPhase;
	reviewId: string | null;
	/** The commit the review read. */
	headSha: string | null;
	/** True when the pull request has commits newer than `headSha`. */
	outdated: boolean;
	/** ISO times; `finishedAt` is null while it runs. */
	startedAt: string | null;
	finishedAt: string | null;
	/** Read the change, find what to check, check each claim, write the summary. Empty when `phase` is `none`. */
	stages: RunStage[];
	/** What the review does right now: the command it runs or the file it reads. */
	activity: string | null;
	/** Why a queued review has not started, in a few words. */
	waiting: string | null;
	/** The model and effort the review runs with: `Opus 5.5 · High`. */
	modelLabel: string | null;
	/** Why the review failed, and the way out the server offered. */
	failure: { message: string; action: FailureAction | null } | null;
	/** `reconnecting` while the live connection is down; the progress shown may be old. */
	connection: 'live' | 'reconnecting';
	/** Starts a review of the pull request's current head. `brief` is what the person asked it to look at. */
	start: (brief?: string) => Promise<void>;
	/** True from the click until the server answers. */
	starting: boolean;
	cancel: () => Promise<void>;
	pause: () => Promise<void>;
	resume: () => Promise<void>;
	/** Continues a failed review from where it stopped. */
	retry: () => Promise<void>;
}
