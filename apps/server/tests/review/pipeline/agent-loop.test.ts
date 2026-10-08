import { afterEach, expect, test } from 'bun:test';
import { ModelBlockedError, ModelBudget, runJsonAgent } from '../../../src/review/pipeline/agent-loop';
import { EvidenceStore } from '../../../src/evidence/evidence';
import type { JsonAgentOptions } from '../../../src/review/pipeline/agent-loop/options';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { REVIEW_POLICY } from '../../../src/review/session/review-policy';
import { parseReviewerOutput, prematureReviewerFinal } from '../../../src/review/pipeline/reviewer';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const config = { model: 'test', baseUrl: 'https://model.test', apiKey: 'test' };

const diff = Array.from(
	{ length: 7 },
	(_, index) => `diff --git a/file${index}.ts b/file${index}.ts
--- a/file${index}.ts
+++ b/file${index}.ts
@@ -1 +1 @@
-old
+new
`
).join('');

type SpecialistOutput = NonNullable<ReturnType<typeof parseReviewerOutput>>;

/** Specialist agent options with test defaults; each test overrides only what it is about. */
function agentOptions(overrides: Partial<JsonAgentOptions<SpecialistOutput>> = {}): JsonAgentOptions<SpecialistOutput> {
	return {
		label: 'correctness',
		stage: 'reviewer',
		system: '',
		user: '',
		config,
		budget: new ModelBudget(),
		evidence: new EvidenceStore(null, buildInventory(diff), 12000),
		maxTurns: 10,
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 300_000,
		parse: parseReviewerOutput,
		...overrides
	};
}

const request = (index: number) =>
	JSON.stringify({ message: 'Inspecting related code.', actions: [{ action: 'readDiff', path: `file${index}.ts` }] });

/** Answers the n-th model call with `reply(n)`, and returns the last message of every prompt sent, as it grows. */
function stubModel(reply: (call: number) => string): string[] {
	const prompts: string[] = [];

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init?.body as string);

		prompts.push(body.messages.at(-1).content);

		return Response.json({ choices: [{ message: { content: reply(prompts.length) } }] });
	}) as typeof fetch;

	return prompts;
}

test('a schema repair preserves all seven evidence rounds and the final result turn', async () => {
	const evidence = new EvidenceStore(null, buildInventory(diff), 12000);
	const budget = new ModelBudget();
	const prompts: string[] = [];
	let calls = 0;

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init?.body as string);

		prompts.push(body.messages.map((message: { content: string }) => message.content).join('\n'));

		const call = calls++;

		return Response.json({
			choices: [
				{
					message: {
						content: call === 0 ? 'malformed' : call <= 7 ? request(call - 1) : '{"findings":[],"examinedHunks":[]}'
					}
				}
			]
		});
	}) as typeof fetch;

	const tools: string[] = [];

	const result = await runJsonAgent(
		agentOptions({
			budget,
			evidence,
			maxTurns: 8,
			onTool: (tool) => {
				if (tool.status === 'done') tools.push(tool.command);
			}
		})
	);

	expect(result.value?.findings).toEqual([]);
	expect(calls).toBe(9);
	expect(budget.used).toBe(9);
	expect(tools).toHaveLength(7);
	for (const prompt of prompts.slice(0, -1)) expect(prompt).not.toContain('This is your final turn');
	expect(prompts.at(-1)).toContain('This is your final turn');
	for (let index = 0; index < 7; index++) expect(prompts.at(-1)).toContain(`file${index}.ts`);
});

test('commentary alone is not treated as completed review and can be repaired into retrieval', async () => {
	const replies = [
		JSON.stringify({ message: 'I could not inspect the repository.' }),
		request(0),
		'{"findings":[],"examinedHunks":[]}'
	];

	globalThis.fetch = (async () =>
		Response.json({ choices: [{ message: { content: replies.shift() } }] })) as unknown as typeof fetch;

	const result = await runJsonAgent(
		agentOptions({
			maxTurns: 2
		})
	);

	expect(result.value?.findings).toEqual([]);
	expect(replies).toHaveLength(0);
	expect(parseReviewerOutput({ message: 'No review performed.' })).toBeNull();
});

test('retrieval cannot consume the consolidation reserve or bypass the deadline', async () => {
	let calls = 0;

	globalThis.fetch = (async () => {
		calls++;

		return Response.json({ choices: [{ message: { content: request(0) } }] });
	}) as unknown as typeof fetch;

	const budget = new ModelBudget(2, 1);

	const options = agentOptions({
		budget,
		maxTurns: 8
	});

	const result = await runJsonAgent(options);

	expect(result.value).toBeNull();
	expect(budget.remaining()).toBe(1);
	expect(options.evidence.records.size).toBe(0);
	expect(calls).toBe(1);

	const expired = await runJsonAgent({
		...options,
		budget: new ModelBudget(),
		deadlineAt: Date.now() + REVIEW_POLICY.reserveMsForConsolidation - 1
	});

	expect(expired.error).toContain('deadline');
	expect(calls).toBe(1);
});

test('a spent hosted plan stops the review with an out-of-usage failure instead of one error per reviewer', async () => {
	let calls = 0;

	globalThis.fetch = (async () => {
		calls++;

		return new Response('{"error":{"message":"Monthly limit reached"}}', { status: 429 });
	}) as unknown as typeof fetch;

	const error = await runJsonAgent(
		agentOptions({
			label: 'reviewer',
			config: { ...config, source: 'opencode-go' },
			maxTurns: 2
		})
	).catch((err: unknown) => err);

	expect(error).toBeInstanceOf(ModelBlockedError);

	expect((error as ModelBlockedError).failure.usageLimit).toMatchObject({
		provider: 'opencode-go',
		name: 'OpenCode Go'
	});

	expect(calls).toBe(1);
});

test('a final answer that announces more work is sent back once instead of ending the reviewer', async () => {
	const replies = [
		JSON.stringify({
			message: "I'm investigating the conventions. Let me gather context on the settings patterns.",
			findings: [],
			examinedHunks: []
		}),
		request(0),
		'{"message":"Done.","findings":[],"examinedHunks":[]}'
	];

	globalThis.fetch = (async () =>
		Response.json({ choices: [{ message: { content: replies.shift() } }] })) as unknown as typeof fetch;

	const tools: string[] = [];

	const result = await runJsonAgent(
		agentOptions({
			label: 'patterns',
			maxTurns: 4,
			checkFinal: prematureReviewerFinal,
			onTool: (tool) => {
				if (tool.status === 'done') tools.push(tool.command);
			}
		})
	);

	expect(result.value?.message).toBe('Done.');
	expect(tools).toHaveLength(1);
	expect(replies).toHaveLength(0);
});

test('an agent past its own time limit is given its final turn instead of more retrieval', async () => {
	const prompts: string[] = [];

	/** Each turn outlasts the 20ms after which the next turn must be the final one. */
	const SLOW_TURN_MS = 30;

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init?.body as string);

		prompts.push(body.messages.at(-1).content);
		await Bun.sleep(SLOW_TURN_MS);

		return Response.json({
			choices: [
				{
					message: {
						content: prompts.length === 1 ? request(0) : '{"message":"Done.","findings":[],"examinedHunks":[]}'
					}
				}
			]
		});
	}) as typeof fetch;

	const result = await runJsonAgent(
		agentOptions({
			label: 'verify',
			timeLimit: { finalTurnAfterMs: 20, maxWallMs: 60_000 }
		})
	);

	expect(result.value?.message).toBe('Done.');
	expect(prompts).toHaveLength(2);
	expect(prompts[1]).toContain('This is your final turn');
});

test('an agent repeating a request that failed is given its final turn instead of retrying until it runs out', async () => {
	const failing = JSON.stringify({
		message: 'Writing the repro.',
		actions: [{ action: 'writeFile', path: 'repro.test.ts' }]
	});

	const prompts = stubModel((call) => (call <= 2 ? failing : '{"message":"Done.","findings":[],"examinedHunks":[]}'));

	const result = await runJsonAgent(
		agentOptions({
			label: 'verify'
		})
	);

	expect(result.value?.message).toBe('Done.');
	expect(prompts).toHaveLength(3);
	expect(prompts[1]).not.toContain('This is your final turn');
	expect(prompts[2]).toContain('This is your final turn');
});

test('with two answer turns, retrieval is refused on both and an agent that keeps asking ends without an answer', async () => {
	const prompts = stubModel(request);
	const tools: string[] = [];

	const result = await runJsonAgent(
		agentOptions({
			maxTurns: 4,
			answerTurns: 2,
			onTool: (tool) => {
				if (tool.status === 'done') tools.push(tool.command);
			}
		})
	);

	expect(result).toEqual({ value: null, error: 'final turn requested retrieval instead of completing' });
	expect(prompts).toHaveLength(4);
	expect(tools).toHaveLength(2);
	expect(prompts.slice(0, 2).map((prompt) => prompt.startsWith('This is your final turn'))).toEqual([false, false]);
	expect(prompts.slice(2).map((prompt) => prompt.startsWith('This is your final turn'))).toEqual([true, true]);
});
