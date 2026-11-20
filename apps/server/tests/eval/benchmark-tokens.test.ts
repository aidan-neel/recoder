import { expect, test } from 'bun:test';
import { emptyTokenUsage, type TokenCall } from '@recoder/shared';
import { stageTokens, tokenLines } from '../../src/eval/benchmark-tokens';

test('failed verifier calls with usage count while partial or absent usage is explicitly excluded', () => {
	const call = (input: number | null, output: number | null): TokenCall => ({
		id: crypto.randomUUID(),
		model: 'swe-2-flash-medium',
		provider: 'devin',
		stage: 'verifier',
		scope: 'pipeline',
		status: 'failed',
		usage: { ...emptyTokenUsage(), inputTokens: input, outputTokens: output, cachedInputTokens: 40 }
	});

	const rows = stageTokens([call(100, 20), call(null, null), call(300, null)]);

	expect(rows).toEqual([
		{
			stage: 'verifier',
			model: 'swe-2-flash-medium',
			calls: 3,
			unknownCalls: 2,
			input: 100,
			cached: 40,
			written: 0,
			output: 20
		}
	]);
});

test('token summaries distinguish excluded calls from unmeasured legacy coverage', () => {
	const lines = (unknownCalls?: number) =>
		tokenLines(
			[
				{
					runs: [
						{
							reviewer: {
								tokens: [
									{
										stage: 'verifier',
										model: 'model',
										calls: 2,
										input: 100,
										cached: 0,
										written: 0,
										output: 20,
										...(unknownCalls === undefined ? {} : { unknownCalls })
									}
								]
							}
						}
					]
				}
			] as unknown as Parameters<typeof tokenLines>[0],
			() => null
		).join('\n');

	expect(lines(1)).toContain('1 calls excluded from token totals (unknown input/output)');
	expect(lines()).toContain('Usage coverage unknown for legacy rows');
	expect(stageTokens([])).toEqual([]);
});
