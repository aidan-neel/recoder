import { expect, test } from 'bun:test';
import { StepUsage } from '../../src/models/step-usage';
import { modelCalls } from '../../src/store';
import { useTempStore } from '../helpers/temp-store';
import { withUsageMetrics } from '../../src/models/metrics';

useTempStore('prefix-metrics-');

/** What each step reports, so its prompt ends at once instead of waiting out the grace period for late usage. */
const STEP_TOKENS = {
	inputTokens: 10,
	outputTokens: 2,
	totalTokens: 12,
	cachedInputTokens: null,
	cacheWriteInputTokens: null,
	reasoningOutputTokens: null
};

test('every step retains its session prefix hashes across later prompts and durable storage', async () => {
	const prefix = { tools: '0123456789abcdef', system: 'fedcba9876543210', opening: '1122334455667788' };

	await withUsageMetrics('unowned', 'pipeline', async () => {
		const usage = new StepUsage({ model: 'fake' });

		for (const turn of [1, 2]) {
			const event = { type: 'prompt-start', session: 'session', turn, prefix };

			usage.promptStarted(event);
			usage.stepStarted(`step-${turn}`);
			usage.stepFinished(STEP_TOKENS, `step-${turn}`);
			await usage.finishPrompt(undefined);
		}
	});

	const rows = await modelCalls.list();

	expect(rows).toHaveLength(2);
	expect(rows.map((row) => row.prefix)).toEqual([prefix, prefix]);
	expect(rows.map((row) => row.turn)).toEqual([1, 2]);

	for (const row of rows) expect(row).not.toHaveProperty('type');
});
