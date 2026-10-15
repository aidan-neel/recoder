import type { DecisionState } from './surface';

export interface DecisionRecord {
	state: Exclude<DecisionState, 'open'>;
	/** What the person wants the author agent to know, for `sent` items. */
	note: string;
	at: number;
}

/** Where one review's decisions live: per head commit, so a new push starts clean. */
export function decisionsKey(reviewId: string, headSha: string): string {
	return `recoder.decisions.v1.${reviewId}@${headSha}`;
}

/** The decisions saved for a review at a commit; empty when there are none or storage is blocked. */
export function readDecisions(reviewId: string, headSha: string): Record<string, DecisionRecord> {
	try {
		return JSON.parse(localStorage.getItem(decisionsKey(reviewId, headSha)) ?? '{}');
	} catch {
		return {};
	}
}

/** Each decided item's state. */
export function decisionStates(records: Record<string, DecisionRecord>): Record<string, DecisionState> {
	return Object.fromEntries(Object.entries(records).map(([id, record]) => [id, record.state]));
}
