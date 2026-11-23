import {
	MODEL_CALL_KINDS,
	type ModelCallRow,
	type ModelCost,
	type ModelProvider,
	type ReportPerson,
	type UsageDay,
	type UsageKind,
	type UsageModel,
	type UsagePerson,
	type UsageReport,
	type UsageTotals,
	type UsageDays
} from '@recoder/shared';
import { ADMIN_ACCOUNT_ID } from '../accounts/account-records';
import { TOKENS_PER_PRICE_UNIT, tokenCost, type PriceLookup } from '../models/model-prices';
import { allReportPeople, groupBy, medianOf, shareOf, utcDay, windowDayKeys } from './report-shared';

/** Who an account is in the report; the account's own record, or what its id says when the record is gone. */
export type UsageIdentity = ReportPerson;

export interface UsageInput {
	days: UsageDays;
	/** The moment the window ends: its last day is this moment's UTC day. */
	now: Date;
	/** The recorded model calls; the report adds up those inside the window. */
	calls: readonly ModelCallRow[];
	/** Every account to list, including those with no usage. */
	people: readonly UsageIdentity[];
	priceOf: PriceLookup;
}

/** One call reduced to what the report adds up. */
interface CallUsage {
	/** The review or chat the call belonged to; `other` calls have none and count as no session. */
	sessionId: string | null;
	kind: ModelCallRow['kind'];
	day: string;
	account: string;
	model: string;
	provider: ModelProvider;
	failed: boolean;
	/** A failed call's error kind. */
	errorKind?: string;
	/** How long the call took, when the row recorded it. */
	durationMs?: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	/** USD, or null when the model, or a kind of token the call used, has no price. */
	costUsd: number | null;
	/** What its cache reads saved against the input price, or null without both prices. */
	savingsUsd: number | null;
}

/**
 * Builds the usage report from recorded calls. It only adds up what it is given, so it needs no storage or clock.
 *
 * Cost of a call is the sum of each kind of token times its price per million: input that was neither read from nor
 * written to the cache (`input` minus both, since providers report `input` including the cached parts), cache reads,
 * cache writes and output. A call with no price for its model, or none for a kind of token it used, has no cost and
 * is never guessed at.
 *
 * A call is placed on the UTC day it started. Calls outside the window are left out.
 */
export function buildUsageReport(input: UsageInput): UsageReport {
	const days = windowDays(input.now, input.days);
	const window = [...days.keys()];

	const calls = input.calls.flatMap((row) => callUsage(row, input.priceOf)).filter((call) => days.has(call.day));

	const total = totalsOf(calls);

	return {
		days: input.days,
		from: window[0],
		to: window[window.length - 1],
		totals: { ...total, cacheSavingsUsd: cacheSavings(calls) },
		people: peopleOf(calls, input.people, total.tokens),
		models: modelsOf(calls, total.tokens),
		kinds: kindsOf(calls),
		daily: dailyOf(calls, days)
	};
}

/** The window's UTC days, oldest first, each starting at no tokens. */
function windowDays(now: Date, count: number): Map<string, UsageDay> {
	return new Map(
		windowDayKeys(now, count).map((day) => [day, { day, tokens: 0, byPerson: {}, byModel: {}, byPersonModel: {} }])
	);
}

function callUsage(row: ModelCallRow, priceOf: PriceLookup): CallUsage[] {
	const day = utcDay(row.at);

	if (!day) return [];

	const input = row.usage.inputTokens ?? 0;
	const cacheRead = row.usage.cachedInputTokens ?? 0;
	const cacheWrite = row.usage.cacheWriteInputTokens ?? 0;
	const output = row.usage.outputTokens ?? 0;
	const price = priceOf(row.model);

	return [
		{
			sessionId: row.ownerId,
			kind: row.kind,
			day,
			account: row.person ?? ADMIN_ACCOUNT_ID,
			model: row.model,
			provider: row.provider,
			failed: row.outcome === 'failed',
			...(row.outcome === 'failed' && { errorKind: row.errorKind ?? 'error' }),
			...(row.durationMs !== undefined && { durationMs: row.durationMs }),
			input,
			cacheRead,
			cacheWrite,
			output,
			costUsd: tokenCost({ input, cacheRead, cacheWrite, output }, price),
			savingsUsd: cacheSavingsOf(cacheRead, price)
		}
	];
}

function cacheSavingsOf(cacheRead: number, price: ModelCost | null): number | null {
	if (cacheRead === 0 || price?.cacheRead === null || price?.cacheRead === undefined) return null;

	return (cacheRead * (price.input - price.cacheRead)) / TOKENS_PER_PRICE_UNIT;
}

function cacheSavings(calls: readonly CallUsage[]): number | null {
	const saved = calls.flatMap((call) => (call.savingsUsd === null ? [] : [call.savingsUsd]));

	return saved.length ? saved.reduce((sum, value) => sum + value, 0) : null;
}

/** The median of the durations a group of calls recorded; null when none did. */
function medianDurationMs(calls: readonly CallUsage[]): number | null {
	return medianOf(calls.flatMap((call) => (call.durationMs === undefined ? [] : [call.durationMs])));
}

/** How many of a group's calls failed with each kind of error. */
function failedByKind(calls: readonly CallUsage[]): Record<string, number> {
	const kinds: Record<string, number> = {};

	for (const call of calls) if (call.errorKind) kinds[call.errorKind] = (kinds[call.errorKind] ?? 0) + 1;

	return kinds;
}

/** The totals of a group of calls. */
function totalsOf(calls: readonly CallUsage[]): UsageTotals {
	const sum = (pick: (call: CallUsage) => number) => calls.reduce((total, call) => total + pick(call), 0);
	const priced = calls.flatMap((call) => (call.costUsd === null ? [] : [call.costUsd]));
	const input = sum((call) => call.input);
	const output = sum((call) => call.output);
	const unpriced = priced.length < calls.length;

	return {
		tokens: input + output,
		input,
		cacheRead: sum((call) => call.cacheRead),
		cacheWrite: sum((call) => call.cacheWrite),
		output,
		costUsd: unpriced && priced.length === 0 ? null : priced.reduce((total, cost) => total + cost, 0),
		costComplete: !unpriced,
		sessions: new Set(calls.flatMap((call) => (call.sessionId === null ? [] : [call.sessionId]))).size,
		calls: calls.length,
		failedCalls: calls.filter((call) => call.failed).length,
		failedByKind: failedByKind(calls),
		medianDurationMs: medianDurationMs(calls)
	};
}

function peopleOf(calls: readonly CallUsage[], known: readonly UsageIdentity[], allTokens: number): UsagePerson[] {
	const byAccount = groupBy(calls, (call) => call.account);

	return allReportPeople(known, byAccount.keys())
		.map((identity) => {
			const personCalls = byAccount.get(identity.accountId) ?? [];
			const totals = totalsOf(personCalls);

			return {
				...identity,
				...totals,
				share: shareOf(totals.tokens, allTokens),
				models: modelsOf(personCalls, totals.tokens)
			};
		})
		.sort((a, b) => b.tokens - a.tokens || a.login.localeCompare(b.login));
}

function modelsOf(calls: readonly CallUsage[], allTokens: number): UsageModel[] {
	return [...groupBy(calls, (call) => JSON.stringify([call.provider, call.model])).values()]
		.map((group) => {
			const totals = totalsOf(group);

			return {
				model: group[0].model,
				provider: group[0].provider,
				...totals,
				share: shareOf(totals.tokens, allTokens)
			};
		})
		.sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}

/** One totals row per call kind, in `MODEL_CALL_KINDS` order; a kind with no calls is all zero. */
function kindsOf(calls: readonly CallUsage[]): UsageKind[] {
	return MODEL_CALL_KINDS.map((kind) => ({ kind, ...totalsOf(calls.filter((call) => call.kind === kind)) }));
}

function dailyOf(calls: readonly CallUsage[], days: Map<string, UsageDay>): UsageDay[] {
	for (const call of calls) {
		const day = days.get(call.day);

		if (!day) continue;

		const tokens = call.input + call.output;

		if (tokens === 0) continue;

		day.tokens += tokens;
		day.byPerson[call.account] = (day.byPerson[call.account] ?? 0) + tokens;
		day.byModel[call.model] = (day.byModel[call.model] ?? 0) + tokens;

		const personModels = (day.byPersonModel[call.account] ??= {});

		personModels[call.model] = (personModels[call.model] ?? 0) + tokens;
	}

	return [...days.values()];
}
