import type { TokenCall, TokenStage } from '@recoder/shared';
import { tokenCost, type PriceLookup } from '../models/model-prices';
import type { ScoredRun } from './benchmark-report';

/** One review's pipeline tokens for one kind of agent on one model. Input counts cache reads and writes too. */
export interface StageTokens {
	stage: TokenStage;
	model: string;
	calls: number;
	/** Calls missing input or output usage, excluded in full from all token sums. Absent in older reports. */
	unknownCalls?: number;
	input: number;
	cached: number;
	written: number;
	output: number;
}

/** Rows summed by stage and model, biggest input first. */
function sumByStage(rows: readonly StageTokens[]): StageTokens[] {
	const groups = new Map<string, StageTokens>();

	for (const row of rows) {
		const key = `${row.stage} ${row.model}`;
		const sum = groups.get(key) ?? { ...row, calls: 0, input: 0, cached: 0, written: 0, output: 0, unknownCalls: 0 };

		sum.calls += row.calls;
		if (sum.unknownCalls !== undefined && row.unknownCalls !== undefined) sum.unknownCalls += row.unknownCalls;
		else delete sum.unknownCalls;
		sum.input += row.input;
		sum.cached += row.cached;
		sum.written += row.written;
		sum.output += row.output;
		groups.set(key, sum);
	}

	return [...groups.values()].sort((a, b) => b.input - a.input);
}

/** A review's pipeline calls summed by stage and model; a call without a stage is `other`. */
export function stageTokens(calls: readonly TokenCall[]): StageTokens[] {
	return sumByStage(
		calls
			.filter((call) => call.scope === 'pipeline')
			.map((call) => {
				const unknown = typeof call.usage.inputTokens !== 'number' || typeof call.usage.outputTokens !== 'number';

				return {
					stage: call.stage ?? 'other',
					model: call.model,
					calls: 1,
					unknownCalls: Number(unknown),
					input: unknown ? 0 : call.usage.inputTokens!,
					cached: unknown ? 0 : (call.usage.cachedInputTokens ?? 0),
					written: unknown ? 0 : (call.usage.cacheWriteInputTokens ?? 0),
					output: unknown ? 0 : call.usage.outputTokens!
				};
			})
	);
}

/** `1.20M`, `45k` or `830`. */
function count(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;

	return String(n);
}

/** `$1.23`, or `n/a` when a model has no price. */
function dollars(cost: number | null): string {
	return cost === null ? 'n/a' : `$${cost.toFixed(2)}`;
}

/** A row's cost at the model's catalog price. */
function rowCost(row: StageTokens, priceOf: PriceLookup): number | null {
	return tokenCost(
		{ input: row.input, cacheRead: row.cached, cacheWrite: row.written, output: row.output },
		priceOf(row.model)
	);
}

/** The line under the stage rows: every row's calls and input, the cache rate, and the cost in all and per review. */
function totalLine(rows: readonly StageTokens[], costs: readonly (number | null)[], reviews: number): string {
	const sum = (field: 'calls' | 'input' | 'cached') => rows.reduce((total, row) => total + row[field], 0);
	const input = sum('input');
	const cost = costs.reduce<number>((total, rowCost) => total + (rowCost ?? 0), 0);
	const unpriced = [...new Set(rows.filter((_, index) => costs[index] === null).map((row) => row.model))];
	const cachedShare = input ? Math.round((sum('cached') / input) * 100) : 0;

	return `  ${'total'.padEnd(41)}${String(sum('calls')).padStart(5)} calls  in ${count(input).padStart(6)}  cached ${cachedShare}%  cost ${dollars(cost)} · ${dollars(cost / reviews)} per review${unpriced.length ? ` (no price: ${unpriced.join(', ')})` : ''}`;
}

/**
 * Every PR run's pipeline tokens summed by stage and model, with what they cost at catalog prices. Uncached is input
 * less cache reads and writes: the part a provider bills at its full input price. A model without a price is left
 * out of the total cost and named.
 */
export function tokenLines(prs: readonly { runs: readonly ScoredRun[] }[], priceOf: PriceLookup): string[] {
	const recorded = prs.flatMap((pr) => pr.runs).filter((run) => run.reviewer?.tokens);
	const rows = sumByStage(recorded.flatMap((run) => run.reviewer?.tokens ?? []));

	if (!rows.length) return [];

	const costs = rows.map((row) => rowCost(row, priceOf));
	const unknown = rows.reduce((sum, row) => sum + (row.unknownCalls ?? 0), 0);

	const coverage = rows.some((row) => row.unknownCalls === undefined)
		? 'Usage coverage unknown for legacy rows.'
		: `${unknown} calls excluded from token totals (unknown input/output); failed calls with reported usage are included. Cached/write counts are provider-reported subtotals.`;

	return [
		'',
		`Tokens by stage (${recorded.length} runs, catalog prices)`,
		coverage,
		...rows.map(
			(row, index) =>
				`  ${row.stage.padEnd(13)}${row.model.padEnd(28)}${String(row.calls).padStart(5)} calls  in ${count(row.input).padStart(6)}  uncached ${count(row.input - row.cached - row.written).padStart(6)}  write ${count(row.written).padStart(6)}  out ${count(row.output).padStart(6)}  cost ${dollars(costs[index] ?? null).padStart(7)}`
		),
		totalLine(rows, costs, recorded.length)
	];
}
