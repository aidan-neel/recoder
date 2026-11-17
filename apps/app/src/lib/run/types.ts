import type { FailureAction, ReviewSpeed } from '@recoder/shared';

import type { RunActivity } from './run-activity';

/** Where the newest review of a pull request stands. `none`: never reviewed. `cancelled`: a person stopped it. */
export type RunPhase = 'none' | 'queued' | 'running' | 'paused' | 'passed' | 'failed' | 'cancelled';

/** A badge on a step: plain, the count of the step at work, or what it found so far. */
export interface RunFact {
	text: string;
	tone: 'neutral' | 'progress' | 'found';
	/** `code` for a path; `time` for how long the step took. */
	kind: 'text' | 'code' | 'time';
}

/** Where a line under a step stands, which sets its mark and colour. */
export type RunMark = 'waiting' | 'working' | 'found' | 'settled' | 'unsure' | 'stopped';

/** One line under a step: a part of the plan or a claim under check, and the word for where it stands. */
export interface RunLine {
	id: string;
	title: string;
	mark: RunMark;
	word: string;
}

/** One step of a review as the Review tab lists it. */
export interface RunStage {
	id: 'read' | 'plan' | 'check' | 'write';
	label: string;
	state: 'waiting' | 'active' | 'done';
	/** How far the active step is, 0 to 1, when it counts its work. */
	share: number | null;
	/** What the step made or is making, as badges: `12 of 31`, `4 reviewers`, `1 found so far`, `1m 12s`. */
	facts: RunFact[];
	/** What the step works through: the plan's parts, or the claims under check. */
	lines: RunLine[];
	/** What the lines leave out: `9 more cleared · 17 waiting`. */
	rest: string | null;
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
	/** What the review does right now: the file it reads, the text it searches for, the command it runs. */
	activity: RunActivity | null;
	/** Why a queued review has not started, in a few words. */
	waiting: string | null;
	/** The model and effort the review runs with: `Opus 5.5 · High`. */
	modelLabel: string | null;
	/** Why the review failed, and the way out the server offered. */
	failure: { message: string; action: FailureAction | null } | null;
	/** `reconnecting` while the live connection is down; the progress shown may be old. */
	connection: 'live' | 'reconnecting';
	/** Starts a review of the pull request's current head: the standard one unless `speed` asks for Spark. */
	start: (speed?: ReviewSpeed) => Promise<void>;
	/** True from the click until the server answers. */
	starting: boolean;
	cancel: () => Promise<void>;
	pause: () => Promise<void>;
	resume: () => Promise<void>;
	/** Continues a failed review from where it stopped. */
	retry: () => Promise<void>;
}
