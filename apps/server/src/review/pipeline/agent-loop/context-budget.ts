import { REVIEW_POLICY } from '../../session/review-policy.js';

/** A token is about four characters of English or code. */
const CHARS_PER_TOKEN = 4;

/** The share of the window at which a transcript is compacted: early enough to leave room for the checkpoint call. */
const COMPACT_AT_SHARE = 0.75;

/** The share of the window past which old tool output is stubbed whatever else happened. */
const HARD_LIMIT_SHARE = 0.9;

/** The share of the window one round of tool results may take. */
const TOOL_ROUND_SHARE = 0.08;

/** What one agent's transcript may grow to, in characters, for its model's context window. */
export interface ContextBudget {
	/** Past this the next call first compacts the transcript into a checkpoint. */
	compactAtChars: number;
	/** Past this old tool results are stubbed when no checkpoint could be made. */
	hardLimitChars: number;
	/** One round of tool results is cut to this. */
	toolRoundChars: number;
}

/**
 * The limits for a model's `contextWindow` (tokens per request). A window of 128k and up keeps the policy's own
 * tool round cap; a small window gets a smaller one, so a few rounds still fit before compaction.
 */
export function contextBudget(contextWindow: number): ContextBudget {
	const windowChars = contextWindow * CHARS_PER_TOKEN;

	return {
		compactAtChars: Math.floor(windowChars * COMPACT_AT_SHARE),
		hardLimitChars: Math.floor(windowChars * HARD_LIMIT_SHARE),
		toolRoundChars: Math.min(REVIEW_POLICY.maxToolRoundChars, Math.floor(windowChars * TOOL_ROUND_SHARE))
	};
}
