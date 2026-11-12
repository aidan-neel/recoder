import { expect, test } from 'bun:test';
import { z } from 'zod';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../../src/agents/contract';
import { EvidenceStore } from '../../src/evidence/evidence';
import { ModelBudget } from '../../src/review/pipeline/agent-loop/budget';
import { runNativeAgent } from '../../src/review/pipeline/agent-loop/native-engine';
import type { JsonAgentOptions } from '../../src/review/pipeline/agent-loop/options';
import { buildInventory } from '../../src/review/pipeline/inventory';
import { allGone, spawnedPids } from './fake-claude';

/** What the fake agents answer: whether they finished, and what each tool call they made returned. */
const answerSchema = z.object({
	done: z.boolean(),
	results: z.array(z.object({ isError: z.boolean().optional(), text: z.string().optional() })).optional()
});

export type FakeAnswer = z.infer<typeof answerSchema>;

/** The one-file change the fake agents read with `read_diff`. */
const DIFF = `diff --git a/file0.ts b/file0.ts
--- a/file0.ts
+++ b/file0.ts
@@ -1 +1 @@
-old
+new
`;

/** A reviewer's options for a run on an agent CLI model, reading the fixture diff, with read tools only. */
function nativeAgentOptions(provider: string, model: string): JsonAgentOptions<FakeAnswer> {
	return {
		label: 'correctness',
		stage: 'reviewer',
		system: 'Review the change.',
		user: 'Is the change correct?',
		config: { provider, model, baseUrl: '', apiKey: '' },
		budget: new ModelBudget(),
		evidence: new EvidenceStore(null, buildInventory(DIFF), 12000),
		maxTurns: 8,
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 300_000,
		parse: (raw) => answerSchema.safeParse(raw).data ?? null,
		responseSchema: () => ({ name: 'answer', schema: { type: 'object' } })
	};
}

/**
 * A fixture review on `agent`'s `model` through the shared engine: its error, if any, and what the first tool
 * call the fake agent made returned.
 */
export async function fixtureReview(
	agent: AgentAdapter,
	model: string
): Promise<{ error?: string; read?: NonNullable<FakeAnswer['results']>[number] }> {
	const { value, error } = await runNativeAgent(nativeAgentOptions(agent.id, model), agent);

	return { error, read: value?.results?.[0] };
}

/** A run of `agent` whose tools all answer `ok`, with the events it sends collected in order. */
export async function openCollectingRun(
	agent: AgentAdapter,
	options: Pick<AgentRunOptions, 'model' | 'reasoningEffort' | 'system' | 'tools'>
): Promise<{ run: AgentRun; events: AgentEvent[] }> {
	const events: AgentEvent[] = [];

	const run = await agent.openRun({
		...options,
		runTool: async () => ({ text: 'ok', isError: false }),
		onEvent: (event) => events.push(event),
		signal: new AbortController().signal
	});

	return { run, events };
}

/**
 * Registers the tests every process-per-prompt run shares: an aborted prompt settles as cancelled and ends every
 * process the CLI started, and a prompt past its time settles as timed out. `open` starts a run on a fake in its
 * `spawn` mode, which starts a `sleep` grandchild, writes both pids to `<log>.pids` and waits.
 */
export function testPromptStops(open: () => Promise<{ run: AgentRun; log: string }>): void {
	test('aborting a prompt kills the CLI and everything it started, and settles as cancelled', async () => {
		const { run, log } = await open();
		const pending = run.prompt('Review it.', { tools: true, timeoutMs: 10_000 });
		const pids = await spawnedPids(log);

		await run.abort();

		const reply = await pending;

		await run.close();

		expect(reply.error?.message).toMatch(/cancel/i);
		expect(await allGone(pids)).toBe(true);
	});

	test('a prompt that runs past its time fails as timed out', async () => {
		const { run } = await open();

		const reply = await run.prompt('Review it.', { tools: true, timeoutMs: 300 });

		await run.close();

		expect(reply.error?.message).toMatch(/timed out/i);
	});
}
