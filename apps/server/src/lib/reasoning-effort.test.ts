import { afterEach, expect, test } from 'bun:test';
import { chatCompletion, resetLlmLimiter, streamChatCompletion } from './llm';
import { configForRole } from './models';
import { setReviewOverrides } from './review-settings';
import { discussFinding, streamDiscussFinding } from './discuss';
import { suggestFix } from './fix';
import { ModelBudget, runJsonAgent } from './agent-loop';
import { EvidenceStore } from './evidence';
import { buildInventory } from './inventory';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	setReviewOverrides({});
	resetLlmLimiter();
});

test('API completions send only explicit role efforts, for shared, override, and fallback models', async () => {
	setReviewOverrides({
		models: [
			{ id: 'shared', label: 'Shared', model: 'shared-model', baseUrl: 'https://example.test/v1', apiKey: 'test' },
			{ id: 'special', label: 'Special', model: 'special-model', baseUrl: 'https://example.test/v1', apiKey: 'test' }
		],
		roles: { security: 'special', docs: 'deleted' },
		roleEfforts: { security: 'high', perf: 'low', docs: 'medium' }
	});
	const bodies: Record<string, unknown>[] = [];
	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init!.body as string);
		bodies.push(body);
		return body.stream
			? new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
			: Response.json({ choices: [{ message: { content: 'ok' } }] });
	}) as typeof fetch;
	for (const role of ['security', 'perf', 'docs', 'testing'] as const) {
		const opts = { ...configForRole(role), messages: [{ role: 'user' as const, content: 'Review' }] };
		await chatCompletion(opts);
		await streamChatCompletion(opts, () => {});
	}
	expect(bodies.map((body) => [body.model, body.reasoning_effort])).toEqual([
		['special-model', 'high'], ['special-model', 'high'],
		['shared-model', 'low'], ['shared-model', 'low'],
		['shared-model', 'medium'], ['shared-model', 'medium'],
		['shared-model', undefined], ['shared-model', undefined]
	]);
	expect(bodies[6]).not.toHaveProperty('reasoning_effort');
	expect(bodies[7]).not.toHaveProperty('reasoning_effort');
});

test('review agent, discussion, streaming discussion, and fix consume resolved role effort', async () => {
	setReviewOverrides({
		models: [{ id: 'shared', label: 'Shared', model: 'shared-model', baseUrl: 'https://example.test/v1', apiKey: 'test' }],
		roleEfforts: { security: 'high' }
	});
	const efforts: string[] = [];
	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init!.body as string);
		efforts.push(body.reasoning_effort);
		return body.stream
			? new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
			: Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Fix', patch: '--- a/test.ts\n+++ b/test.ts\n' }) } }] });
	}) as typeof fetch;
	const finding = { agent: 'security', file: 'test.ts', line: 1, endLine: 1, severity: 'warning', message: 'Issue', diff: '', sandboxPath: null };
	await discussFinding({ ...finding, history: [], question: 'Why?' });
	await streamDiscussFinding({ ...finding, history: [], question: 'Why?' }, () => {});
	await suggestFix(finding);
	const result = await runJsonAgent({
		label: 'security', system: '', user: '', config: configForRole('security'),
		budget: new ModelBudget(), evidence: new EvidenceStore(null, buildInventory(''), 1000),
		maxTurns: 1, signal: new AbortController().signal, deadlineAt: Date.now() + 120_000,
		parse: () => ({ ok: true })
	});
	expect(result.value).toEqual({ ok: true });
	expect(efforts).toEqual(['high', 'high', 'high', 'high']);
});
