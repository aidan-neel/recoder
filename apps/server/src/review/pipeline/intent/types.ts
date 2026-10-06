/** Where a piece of intent context came from. */
export type IntentSourceKind =
	'pr' | 'issue' | 'comment' | 'review-thread' | 'commit' | 'pr-history' | 'stack' | 'past-review';

/** One piece of gathered context. Always untrusted text. */
export interface IntentSource {
	kind: IntentSourceKind;
	/**
	 * Stable id the distilled claims cite: `pr`, `issue:#12`, `comment:#12/3`,
	 * `commit:abc1234`, `pr:#31`, `merge:abc1234`, `history:unavailable`.
	 */
	ref: string;
	url?: string;
	title?: string;
	author?: string;
	/** ISO time, when the host reports one. */
	at?: string;
	/** History only: the commit the source was read from, such as the merge that landed an earlier PR. */
	revision?: string;
	/** History only: the commits that landed together as a `git log` range, `parent..tip`, or a root commit's sha. */
	range?: string;
	/** History PRs only: true when a retrieved PR record backs it, false when only a commit or merge message names it. */
	recorded?: boolean;
	/** Clipped body text. */
	text: string;
}

/** A pull request next to this one in a stack, or one an older commit came from. */
export interface PrRef {
	number: number;
	title: string;
	url?: string;
	state: string;
	headRef: string;
	baseRef: string;
}

/**
 * Everything gathered about why the change exists, before any model reads it.
 * Sources are sorted by kind, then ref, then time, so caps always cut in the same place.
 */
export interface GatheredContext {
	sources: IntentSource[];
	stack: { parent: PrRef | null; children: PrRef[] };
	/** People and labels, as one short untrusted block (what `prContext` used to carry). */
	people: string;
}

/** One distilled statement about the change, citing the source it came from. */
export interface IntentClaim {
	/** `G1`, `A2`, `C1`, `N1`, `D3`: kind letter and position, so lenses and the verifier can cite it. */
	id: string;
	text: string;
	/** An `IntentSource.ref`. */
	source: string;
}

/** One statement about the changed code, pinned to a line of the change. */
export interface CodeClaim {
	/** `O1`, `Q2`: kind letter and position. */
	id: string;
	text: string;
	file: string;
	line: number;
}

/**
 * What the change is meant to do and what its code does, distilled from the
 * gathered context, the changed declarations and the diff in one
 * cached model call. Lenses check acceptance criteria and constraints against
 * the code; consolidation drops findings a non-goal or the stacked parent covers.
 */
export interface ChangeIntent {
	/** One or two sentences: what the PR does and why. */
	summary: string;
	goals: IntentClaim[];
	acceptanceCriteria: IntentClaim[];
	/** "No behavior change", "backwards compatible", "migration runs once". */
	statedConstraints: IntentClaim[];
	/** Deferred or explicitly out of scope ("follow-up in #42"). */
	nonGoals: IntentClaim[];
	/** Why the code is shaped this way, from older PRs, commits and threads. */
	priorDecisions: IntentClaim[];
	/** Old behavior against new, one per changed declaration; a reviewer's starting point, never proof. */
	observedChanges: CodeClaim[];
	/** A contract or caller the change may break, for a reviewer to settle against the code. */
	openQuestions: CodeClaim[];
	stack: GatheredContext['stack'];
}
