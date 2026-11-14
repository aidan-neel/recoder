import type { AccountRole, SignInForge } from './accounts';
import type { ModelProvider } from './models';
import type { ModelCallKind } from './telemetry';

/** The windows `GET /api/usage?days=` accepts. */
export const USAGE_DAYS = [7, 30, 90] as const;
export type UsageDays = (typeof USAGE_DAYS)[number];
export const DEFAULT_USAGE_DAYS: UsageDays = 30;

/**
 * What a group of model calls (one person's, one model's, or all of them) used. Counts are the providers' own:
 * `input` includes `cacheRead` and `cacheWrite`, and `output` includes reasoning tokens.
 */
export interface UsageTotals {
	/** Processed tokens: `input` plus `output`. */
	tokens: number;
	/** All input tokens, the cached ones included. */
	input: number;
	/** The part of `input` read from the provider's prompt cache. */
	cacheRead: number;
	/** The part of `input` written to the provider's prompt cache. */
	cacheWrite: number;
	output: number;
	/**
	 * USD at the catalog's prices. A call whose model has no known price, or no price for a kind of token it used,
	 * adds nothing here, so this is a lower bound while `costComplete` is false. Null when the group has calls but none
	 * with a known cost; 0 when it has no calls.
	 */
	costUsd: number | null;
	/** True when every call in the group has a known cost. */
	costComplete: boolean;
	/** Reviews plus chats with at least one call in the window. */
	sessions: number;
	/** Model calls in the group, failed and cancelled ones included. */
	calls: number;
	/** Calls that failed; cancelled calls are not counted here. */
	failedCalls: number;
	/** Median wall-clock duration of the calls that recorded one; null when none did. */
	medianDurationMs: number | null;
}

/** The totals of one kind of model call: review work, repository chats, or work outside both. */
export interface UsageKind extends UsageTotals {
	kind: ModelCallKind;
}

/** One account in the report. */
export interface UsagePerson extends UsageTotals {
	accountId: string;
	role: AccountRole;
	provider: SignInForge;
	/** GitLab's self-managed host; null for github.com and gitlab.com. */
	host: string | null;
	login: string;
	avatarUrl?: string;
	/** This person's part of all tokens in the window, 0 to 1. */
	share: number;
	/** The models this person's calls used, most tokens first; each `share` is of this person's tokens. */
	models: UsageModel[];
}

/** One model in the report, by the id the calls were made with (`claude-opus-5-5`, `glm-5.2`). */
export interface UsageModel extends UsageTotals {
	model: string;
	provider: ModelProvider;
	/** This model's part of all tokens in the window, 0 to 1. */
	share: number;
}

/** One UTC day of the window. */
export interface UsageDay {
	/** `YYYY-MM-DD`. */
	day: string;
	tokens: number;
	/** Tokens by account id; only people with tokens that day. */
	byPerson: Record<string, number>;
	/** Tokens by model id; only models with tokens that day. */
	byModel: Record<string, number>;
	/** Tokens by account id, then by model id, for one person's view of the day; only non-zero entries. */
	byPersonModel: Record<string, Record<string, number>>;
}

/**
 * `GET /api/usage?days=7|30|90` (admin only; 403 `admin-only` for a member; 30 when `days` is left out, 400 for any
 * other value). Calls are placed on the UTC day they started. Each call counts for the person recorded on it — the
 * account that started its review or chat — and calls with no person count for the admin.
 */
export interface UsageReport {
	days: UsageDays;
	/** First day of the window, `YYYY-MM-DD`, inclusive. */
	from: string;
	/** Last day of the window, today by the server's UTC clock, inclusive. */
	to: string;
	totals: UsageTotals & {
		/**
		 * What the cache reads would have cost at the input price, minus what they cost. Only calls with both prices
		 * count; null when no call with cache reads has them.
		 */
		cacheSavingsUsd: number | null;
	};
	/** Everyone who has signed in, the admin and members, including people with no usage; most tokens first. */
	people: UsagePerson[];
	/** Models with calls in the window, most tokens first. */
	models: UsageModel[];
	/** Totals per call kind — `review`, `chat` and `other` — in that order, zero-filled when a kind had none. */
	kinds: UsageKind[];
	/** One entry for each day of the window, oldest first; days without calls are zero. */
	daily: UsageDay[];
}
