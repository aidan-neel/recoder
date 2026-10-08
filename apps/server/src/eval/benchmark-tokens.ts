import type { TokenCall, TokenStage } from '@recoder/shared';
import type { ScoredRun } from './benchmark-report';

/** One review's pipeline tokens for one kind of agent on one model. Input counts cache reads and writes too. */
export interface StageTokens {
	stage: TokenStage;
	model: string;
	calls: number;
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
		const sum = groups.get(key) ?? { ...row, calls: 0, input: 0, cached: 0, written: 0, output: 0 };

		sum.calls += row.calls;
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
			.map((call) => ({
				stage: call.stage ?? 'other',
				model: call.model,
				calls: 1,
				input: call.usage.inputTokens ?? 0,
				cached: call.usage.cachedInputTokens ?? 0,
				written: call.usage.cacheWriteInputTokens ?? 0,
				output: call.usage.outputTokens ?? 0
			}))
	);
}

/** `1.20M`, `45k` or `830`. */
function count(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;

	return String(n);
}

/**
 * Every run's pipeline tokens summed by stage and model. Uncached is input less cache reads and writes: the part
 * a provider bills at its full input price.
 */
export function tokenLines(runs: readonly ScoredRun[]): string[] {
	const recorded = runs.filter((run) => run.reviewer?.tokens);
	const rows = sumByStage(recorded.flatMap((run) => run.reviewer?.tokens ?? []));

	if (!rows.length) return [];

	return [
		'',
		`Tokens by stage (${recorded.length} runs)`,
		...rows.map(
			(row) =>
				`  ${row.stage.padEnd(13)}${row.model.padEnd(28)}${String(row.calls).padStart(5)} calls  in ${count(row.input).padStart(6)}  uncached ${count(row.input - row.cached - row.written).padStart(6)}  write ${count(row.written).padStart(6)}  out ${count(row.output).padStart(6)}`
		)
	];
}
