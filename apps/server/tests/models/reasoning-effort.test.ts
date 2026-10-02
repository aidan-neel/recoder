import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { chatCompletion, resetLlmLimiter, streamChatCompletion } from '../../src/models/llm';
import { configForRole } from '../../src/models/models';
import { setReviewOverrides } from '../../src/review/session/review-settings';
import { discussFinding, streamDiscussFinding } from '../../src/review/chat/discuss';
import { suggestFix } from '../../src/review/fixes/fix';
import { ModelBudget, runJsonAgent } from '../../src/review/pipeline/agent-loop';
import { EvidenceStore } from '../../src/evidence/evidence';
import { buildInventory } from '../../src/review/pipeline/inventory';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
	setReviewOverrides({});
	resetLlmLimiter();
});

test('API completions send the Specialist effort only when one is set', async () => {
	const endpoint = { baseUrl: 'https://example.test/v1', apiKey: 'test' };
	const bodies: Record<string, unknown>[] = [];

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init!.body as string);

		bodies.push(body);

		return body.stream
			? new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
			: Response.json({ choices: [{ message: { content: 'ok' } }] });
	}) as typeof fetch;

	const call = async () => {
		const opts = { ...configForRole('security'), messages: [{ role: 'user' as const, content: 'Review' }] };

		await chatCompletion(opts);
		await streamChatCompletion(opts, () => {});
	};

	const models = [
		{ id: 'review', label: 'Review', model: 'review-model', ...endpoint },
		{ id: 'special', label: 'Special', model: 'special-model', ...endpoint }
	];

	setReviewOverrides({ models, specialistModelId: 'special', specialistEffort: 'high' });
	await call();
	setReviewOverrides({ models, specialistModelId: 'special' });
	await call();

	expect(bodies.map((body) => [body.model, body.reasoning_effort])).toEqual([
		['special-model', 'high'],
		['special-model', 'high'],
		['special-model', undefined],
		['special-model', undefined]
	]);

	expect(bodies[2]).not.toHaveProperty('reasoning_effort');
});

test('review agent, discussion, streaming discussion, and fix consume resolved role effort', async () => {
	setReviewOverrides({
		models: [
			{ id: 'shared', label: 'Shared', model: 'shared-model', baseUrl: 'https://example.test/v1', apiKey: 'test' }
		],
		specialistEffort: 'high'
	});

	const efforts: string[] = [];

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init!.body as string);

		efforts.push(body.reasoning_effort);

		return body.stream
			? new Response(
					`data: ${JSON.stringify({ choices: [{ delta: { content: body.response_format ? '{"message":"Checked the evidence","ok":true}' : 'ok' } }] })}\n\ndata: [DONE]\n\n`
				)
			: Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({ summary: 'Fix', edits: [{ file: 'test.ts', find: 'old', replace: 'new' }] })
							}
						}
					]
				});
	}) as typeof fetch;

	const finding = {
		agent: 'security',
		file: 'test.ts',
		line: 1,
		endLine: 1,
		severity: 'warning',
		message: 'Issue',
		diff: '',
		sandboxPath: null
	};

	await discussFinding({ ...finding, history: [], question: 'Why?' });
	await streamDiscussFinding({ ...finding, history: [], question: 'Why?' }, () => {});

	const checkout = mkdtempSync(join(tmpdir(), 'recoder-effort-fix-'));

	writeFileSync(join(checkout, 'test.ts'), 'old\n');
	await suggestFix({ ...finding, sandboxPath: checkout });

	const result = await runJsonAgent({
		label: 'security',
		system: '',
		user: '',
		config: configForRole('security'),
		budget: new ModelBudget(),
		evidence: new EvidenceStore(null, buildInventory(''), 1000),
		maxTurns: 1,
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 120_000,
		parse: () => ({ ok: true })
	});

	expect(result.value).toEqual({ ok: true });
	expect(efforts).toEqual(['high', 'high', 'high', 'high']);
});
