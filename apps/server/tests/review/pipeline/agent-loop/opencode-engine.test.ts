import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop/budget';
import { runOpenCodeAgent } from '../../../../src/review/pipeline/agent-loop/opencode-engine';
import type { JsonAgentOptions } from '../../../../src/review/pipeline/agent-loop/options';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { useFakeOpenCode } from '../../../helpers/fake-opencode';

interface Answer {
	done: boolean;
	results?: { isError?: boolean; text?: string; off?: boolean }[];
	prompt?: string;
	toolsOn?: boolean;
}

interface Call {
	method: string;
	path: string;
}

const diff = `diff --git a/file0.ts b/file0.ts
--- a/file0.ts
+++ b/file0.ts
@@ -1 +1 @@
-old
+new
`;

const startAgent = useFakeOpenCode();

const readDiff = { tool: 'read_diff', args: { path: 'file0.ts' } };

/** What the fake OpenCode runs: the tool calls of each step, then the answer. */
function script(
	steps: { tool: string; args: Record<string, unknown> }[][],
	extra: Record<string, unknown> = {}
): string {
	return JSON.stringify({ steps, answer: { done: true }, ...extra });
}

function agentOptions(overrides: Partial<JsonAgentOptions<Answer>> = {}): JsonAgentOptions<Answer> {
	return {
		label: 'correctness',
		system: '',
		user: '',
		config: { provider: 'opencode', model: 'openai/m', baseUrl: '', apiKey: '' },
		budget: new ModelBudget(),
		evidence: new EvidenceStore(null, buildInventory(diff), 12000),
		maxTurns: 8,
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 300_000,
		parse: (raw) => raw as Answer,
		responseSchema: () => ({ name: 'answer', schema: { type: 'object' } }),
		...overrides
	};
}

test('a tool call from OpenCode reads the review evidence and each model step spends one call', async () => {
	const budget = new ModelBudget();
	const tools: string[] = [];

	const result = await runOpenCodeAgent(
		agentOptions({
			user: script([[readDiff]]),
			budget,
			onTool: (tool) => {
				if (tool.status === 'done') tools.push(tool.command);
			}
		}),
		await startAgent()
	);

	expect(result.value?.results?.[0].isError).toBe(false);
	expect(result.value?.results?.[0].text).toContain('+new');
	expect(tools).toHaveLength(1);
	expect(budget.used).toBe(2);
});

test('a read-only agent is not offered run, and a call to it is refused', async () => {
	const target = await startAgent();
	const run = { tool: 'run', args: { command: 'id' } };
	const offered = await runOpenCodeAgent(agentOptions({ user: script([[run]]) }), target);

	expect(offered.value?.results).toEqual([{ off: true }]);
});

test('tools are refused on the last turn even when a step is reported after its tool calls', async () => {
	const start = await startAgent();

	for (const lateStart of [false, true]) {
		const result = await runOpenCodeAgent(
			agentOptions({ user: script([[readDiff], [readDiff], [readDiff]], { lateStart }), maxTurns: 3 }),
			start
		);

		expect(result.value?.results?.map((item) => item.isError)).toEqual([false, false, true]);
		expect(result.value?.results?.[2].text).toContain('final turn');
	}
});

test('an agent with no model calls left is not started', async () => {
	const budget = new ModelBudget(3, 3);
	const result = await runOpenCodeAgent(agentOptions({ user: script([[readDiff]]), budget }), await startAgent());

	expect(result).toEqual({ value: null, error: 'model-call budget exhausted' });
	expect(budget.used).toBe(0);
});

test('an agent that keeps taking steps past its turns is stopped and asked to answer without tools', async () => {
	const budget = new ModelBudget();

	const result = await runOpenCodeAgent(
		agentOptions({
			user: script([[readDiff], [readDiff], [readDiff], [readDiff], [readDiff], [readDiff]]),
			maxTurns: 2,
			budget
		}),
		await startAgent()
	);

	expect(result.value?.done).toBe(true);
	expect(result.value?.toolsOn).toBe(false);
	expect(budget.used).toBeLessThanOrEqual(5);
});

test('aborting the review stops the run and deletes its OpenCode session', async () => {
	const target = await startAgent();
	const controller = new AbortController();

	const run = runOpenCodeAgent(
		agentOptions({ user: script([[readDiff]], { hang: true }), signal: controller.signal }),
		target
	);

	setTimeout(() => controller.abort(), 150);

	await expect(run).rejects.toThrow('review aborted');

	const calls = (await target.request('/test/calls')) as Call[];

	expect(calls.some((call) => call.method === 'DELETE' && call.path === '/session/ses_1')).toBe(true);
});
