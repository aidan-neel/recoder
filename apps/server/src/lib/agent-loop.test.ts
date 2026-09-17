import { afterEach, expect, test } from 'bun:test';
import { ModelBudget, runJsonAgent } from './agent-loop';
import { EvidenceStore } from './evidence';
import { buildInventory } from './inventory';
import { REVIEW_POLICY } from './review-policy';
import { parseSpecialistOutput } from './specialist';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const config = { role: 'correctness' as const, model: 'test', baseUrl: 'https://model.test', apiKey: 'test' };
const diff = Array.from({ length: 7 }, (_, index) => `diff --git a/file${index}.ts b/file${index}.ts
--- a/file${index}.ts
+++ b/file${index}.ts
@@ -1 +1 @@
-old
+new
`).join('');
const request = (index: number) => JSON.stringify({ message: 'Inspecting related code.', actions: [{ action: 'readDiff', path: `file${index}.ts` }] });

test('a schema repair preserves all seven evidence rounds and the final result turn', async () => {
	const evidence = new EvidenceStore(null, buildInventory(diff), 12000);
	const budget = new ModelBudget();
	const prompts: string[] = [];
	let calls = 0;
	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init?.body as string);
		prompts.push(body.messages.map((message: { content: string }) => message.content).join('\n'));
		const call = calls++;
		return Response.json({ choices: [{ message: { content: call === 0 ? 'malformed' : call <= 7 ? request(call - 1) : '{"findings":[],"examinedHunks":[]}' } }] });
	}) as typeof fetch;
	const tools: string[] = [];
	const result = await runJsonAgent({ label: 'correctness', system: '', user: '', config, budget, evidence,
		maxTurns: REVIEW_POLICY.maxSpecialistTurns, signal: new AbortController().signal,
		deadlineAt: Date.now() + 300_000, parse: parseSpecialistOutput,
		onTool: (tool) => { if (tool.status === 'done') tools.push(tool.command); }
	});
	expect(result.value?.findings).toEqual([]);
	expect(calls).toBe(9);
	expect(budget.used).toBe(9);
	expect(tools).toHaveLength(7);
	for (const prompt of prompts.slice(0, -1)) expect(prompt).not.toContain('This is your final turn');
	expect(prompts.at(-1)).toContain('This is your final turn');
	for (let index = 0; index < 7; index++) expect(prompts.at(-1)).toContain(`file${index}.ts`);
});

test('commentary alone is not treated as completed review and can be repaired into retrieval', async () => {
	const replies = [JSON.stringify({ message: 'I could not inspect the repository.' }), request(0), '{"findings":[],"examinedHunks":[]}'];
	globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: replies.shift() } }] })) as unknown as typeof fetch;
	const result = await runJsonAgent({ label: 'correctness', system: '', user: '', config,
		budget: new ModelBudget(), evidence: new EvidenceStore(null, buildInventory(diff), 12000),
		maxTurns: 2, signal: new AbortController().signal, deadlineAt: Date.now() + 300_000,
		parse: parseSpecialistOutput
	});
	expect(result.value?.findings).toEqual([]);
	expect(replies).toHaveLength(0);
	expect(parseSpecialistOutput({ message: 'No review performed.' })).toBeNull();
});

test('retrieval cannot consume the consolidation reserve or bypass the deadline', async () => {
	let calls = 0;
	globalThis.fetch = (async () => { calls++; return Response.json({ choices: [{ message: { content: request(0) } }] }); }) as unknown as typeof fetch;
	const budget = new ModelBudget(2, 1);
	const options = { label: 'correctness', system: '', user: '', config, budget,
		evidence: new EvidenceStore(null, buildInventory(diff), 12000), maxTurns: 8,
		signal: new AbortController().signal, deadlineAt: Date.now() + 300_000, parse: parseSpecialistOutput };
	const result = await runJsonAgent(options);
	expect(result.value).toBeNull();
	expect(budget.remaining()).toBe(1);
	expect(options.evidence.records.size).toBe(0);
	expect(calls).toBe(1);
	const expired = await runJsonAgent({ ...options, budget: new ModelBudget(), deadlineAt: Date.now() + REVIEW_POLICY.reserveMsForConsolidation - 1 });
	expect(expired.error).toContain('deadline');
	expect(calls).toBe(1);
});
