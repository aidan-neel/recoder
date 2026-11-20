import type { ModelProvider, ReasoningEffort } from './models';
import type { TokenStage, TokenUsage, VerifierSessionUsage } from './metrics';
import type { Provider } from './repo';
import type { ReportPerson, UsageDays } from './usage';

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
	/** Agent session identifier; absent on older rows and engines that do not report it. */
	session?: string;
	/** One-based prompt index within that agent session. */
	turn?: number;
	/** Short hashes of Recoder's catalog name, system and opening message; absent on older rows. */
	prefix?: { tools: string; system: string; opening: string };
	provider: ModelProvider;
	model: string;
	/** The reasoning effort the call ran with; absent when the caller set none. */
	effort?: ReasoningEffort;
	/** Provider-reported counts; nulls where the provider reported nothing. */
	usage: TokenUsage;
	verifierSession?: VerifierSessionUsage;
	/** Wall-clock start to settle; absent on rows backfilled from records that did not keep it. */
	durationMs?: number;
	outcome: ModelCallOutcome;
	/** A short classification of a failed call's error; absent on other outcomes. */
	errorKind?: string;
	/** The review worker (`RECODER_INSTANCE_ID`) that ran the call; absent without shared storage or off-pipeline. */
	worker?: string;
}

/**
 * Pull request, review and finding counts over a window (for everyone, one person, or one repository).
 * Findings on re-reviews of the same pull request are deduplicated by `finding.id` so carried or
 * rechecked issues are counted once when first raised and once by their current decision.
 */
export interface TelemetryTotals {
	/** Distinct pull requests reviewed or triaged in the window. */
	prsReviewed: number;
	/** Distinct reviewed pull requests merged in the window. */
	prsMerged: number;
	/** Passed reviews completed in the window. */
	reviews: number;
	/** Passed reviews started by a webhook or the auto-review watcher in the window. */
	autoReviews: number;
	/** Distinct non-quieted findings first raised by passed reviews in the window. */
	findings: number;
	/** Distinct `error` findings first raised in the window. */
	highFindings: number;
	/** Distinct `warning` findings first raised in the window. */
	mediumFindings: number;
	/** Distinct `info` findings first raised in the window. */
	lowFindings: number;
	/** Distinct findings accepted in the window. */
	findingsAccepted: number;
	/** Distinct findings dismissed in the window. */
	findingsDismissed: number;
	/**
	 * Distinct findings first raised in the window that met the repository's commit-check threshold
	 * (verified, not dismissed, not quieted, outside ignored paths, and at or above `checkThreshold`).
	 */
	findingsBlocking: number;
	/** Distinct earlier findings confirmed fixed by passed re-reviews in the window. */
	findingsResolved: number;
	/** Distinct findings posted to the pull request in the window. */
	findingsPosted: number;
	/** Processed tokens (`input` plus `output`) across passed reviews in the window that recorded model calls. */
	reviewTokens: number;
	/** Mean processed tokens per passed review in the window that recorded model calls; null when none did. */
	avgTokensPerReview: number | null;
}

/** One repository in the telemetry report. */
export interface TelemetryRepo extends TelemetryTotals {
	repoId: string;
	name: string;
	provider: Provider;
	/** Share of pull requests reviewed in the scope, 0 to 1. */
	share: number;
}

/** One account in the telemetry report. */
export interface TelemetryPerson extends TelemetryTotals, ReportPerson {
	/** Share of pull requests reviewed across people in the window, 0 to 1. */
	share: number;
	/** Repositories this person reviewed or triaged in the window, most pull requests first. */
	repos: TelemetryRepo[];
}

/** One UTC day of the telemetry window. */
export interface TelemetryDay {
	/** `YYYY-MM-DD`. */
	day: string;
	/** Distinct pull requests reviewed or triaged on this day. */
	prsReviewed: number;
	/** Distinct reviewed pull requests merged on this day. */
	prsMerged: number;
	/** Passed reviews completed on this day. */
	reviews: number;
	/** Distinct findings first raised on this day. */
	findings: number;
	/** Findings accepted on this day. */
	findingsAccepted: number;
	/** Findings dismissed on this day. */
	findingsDismissed: number;
	/** Blocking findings first raised on this day. */
	findingsBlocking: number;
	/** Distinct pull requests reviewed or triaged by account id; only non-zero entries. */
	byPerson: Record<string, number>;
	/** Distinct pull requests reviewed or triaged by repository id; only non-zero entries. */
	byRepo: Record<string, number>;
	/** Distinct pull requests reviewed or triaged by account id, then repository id; only non-zero entries. */
	byPersonRepo: Record<string, Record<string, number>>;
}

/**
 * `GET /api/telemetry?days=7|30|90` (admin only; 403 `admin-only` for a member; 30 when `days` is left out,
 * 400 for any other value). Reviews, decisions and merges are placed on their UTC day.
 */
export interface TelemetryReport {
	days: UsageDays;
	/** First day of the window, `YYYY-MM-DD`, inclusive. */
	from: string;
	/** Last day of the window, today by the server's UTC clock, inclusive. */
	to: string;
	totals: TelemetryTotals;
	/** Everyone who has signed in, the admin and members, most pull requests reviewed first. */
	people: TelemetryPerson[];
	/** Repositories with telemetry activity in the window, most pull requests reviewed first. */
	repos: TelemetryRepo[];
	/** One entry for each day of the window, oldest first. */
	daily: TelemetryDay[];
}
