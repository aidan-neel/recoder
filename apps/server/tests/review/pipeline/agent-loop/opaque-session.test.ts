import { expect, test } from 'bun:test';
import type { AgentAdapter, AgentRunOptions, AgentPromptOptions } from '../../../../src/agents/contract';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { DIFF } from '../harness-fixtures';
import { runNativeAgent } from '../../../../src/review/pipeline/agent-loop/native-engine';
import { doneAgentOptions } from '../../../helpers/done-agent';
import { envFlag } from '../../../helpers/env-flag';

envFlag('RECODER_VERIFIER_SESSION_FIXES', '1');

const config = { provider: 'opaque-test', model: 'fake', baseUrl: '', apiKey: '', contextWindow: 32000 };

/** An opaque CLI whose retries share one tool lease and emit usage only when each prompt ends. */
function adapter(counts: number[]) {
	let prompts = 0;
	const results: boolean[] = [];
	let stopped = false;

	const agent = {
		stepGranularity: 'prompt',
		openRun: async (options: AgentRunOptions) => ({
			prompt: async (_text: string, prompt: AgentPromptOptions) => {
				prompts++;
				stopped = false;
				options.onEvent({ type: 'step-start' });

				if (prompt.tools) {
					for (let index = 0; index < (counts[prompts - 1] ?? 20); index++) {
						results.push((await options.runTool('read_diff', { path: 'src/a.ts' })).isError);
						if (stopped) break;
					}
				}

				options.onEvent({
					type: 'usage',
					usage: {
						inputTokens: 1,
						outputTokens: 1,
						totalTokens: 2,
						cachedInputTokens: 0,
						cacheWriteInputTokens: 0,
						reasoningOutputTokens: 0
					}
				});

				return { text: prompt.tools && prompts < counts.length ? 'invalid JSON' : '{"done":true}' };
			},
			abort: async () => {
				stopped = true;
			},
			close: async () => {}
		})
	} as unknown as AgentAdapter;

	return { agent, results, prompts: () => prompts };
}

test('an opaque verifier progresses through more than four operations in one prompt', async () => {
	const fake = adapter([6]);

	const result = await runNativeAgent(
		doneAgentOptions(config, {
			stage: 'verifier',
			maxTurns: 4,
			evidence: new EvidenceStore(null, buildInventory(DIFF), 12000)
		}),
		fake.agent
	);

	expect(result.value).toEqual({ done: true });
	expect(fake.results).toEqual(Array(6).fill(false));
	expect(fake.prompts()).toBe(1);
});

test('an opaque verifier retry cannot reset the overall bound and exhaustion forces answer-only finalization', async () => {
	const fake = adapter([3, 20]);

	const result = await runNativeAgent(
		doneAgentOptions(config, {
			stage: 'verifier',
			maxTurns: 3,
			evidence: new EvidenceStore(null, buildInventory(DIFF), 12000)
		}),
		fake.agent
	);

	expect(result.value).toEqual({ done: true });
	expect(result.opBudgetExhausted).toBe(true);
	expect(fake.results).toEqual(Array(8).fill(false));
	expect(fake.prompts()).toBe(3);
});
