import type { ModelProvider, ReasoningEffort } from './models';
import type { TokenStage, TokenUsage } from './metrics';

/** What a recorded model call belonged to: a review, a repository chat, or work without either. */
export const MODEL_CALL_KINDS = ['review', 'chat', 'other'] as const;
export type ModelCallKind = (typeof MODEL_CALL_KINDS)[number];

/** How a recorded model call ended. */
export type ModelCallOutcome = 'ok' | 'failed' | 'cancelled';

/**
 * One model call, recorded in the server's store once it settles: who it was for, what it
 * spent and how it ended. It carries identifiers and token counts only — never prompt text,
 * keys or credentials.
 */
export interface ModelCallRow {
	/** The call's own id; a review's metrics record the same call under it. */
	id: string;
	/** When the call started, an ISO timestamp. */
	at: string;
	/** The account that started the work the call belongs to; null when there was none. */
	person: string | null;
	kind: ModelCallKind;
	/** The review's or chat's id; null for `other` calls. */
	ownerId: string | null;
	/** The kind of agent that made the call; absent on calls made outside an agent run. */
	stage?: TokenStage;
	provider: ModelProvider;
	model: string;
	/** The reasoning effort the call ran with; absent when the caller set none. */
	effort?: ReasoningEffort;
	/** Provider-reported counts; nulls where the provider reported nothing. */
	usage: TokenUsage;
	/** Wall-clock start to settle; absent on rows backfilled from records that did not keep it. */
	durationMs?: number;
	outcome: ModelCallOutcome;
	/** A short classification of a failed call's error; absent on other outcomes. */
	errorKind?: string;
	/** The review worker (`RECODER_INSTANCE_ID`) that ran the call; absent without shared storage or off-pipeline. */
	worker?: string;
}
