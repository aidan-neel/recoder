import { afterEach, expect, test } from 'bun:test';
import type { ChatMessage } from '../../../../src/models/llm';
import { ModelBudget, ReviewAbortedError, runJsonAgent } from '../../../../src/review/pipeline/agent-loop';
import {
	applyCheckpoint,
	CHECKPOINT_REQUEST,
	MAX_CHECKPOINTS
} from '../../../../src/review/pipeline/agent-loop/checkpoint';
import { executeTurn } from '../../../../src/review/pipeline/agent-loop/delegation';
import { contextBudget } from '../../../../src/review/pipeline/agent-loop/context-budget';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import type { JsonAgentOptions } from '../../../../src/review/pipeline/agent-loop/options';
import { ReviewControl, runWithReviewControl } from '../../../../src/review/session/review-control';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;

afterEach(() => {
	globalThis.fetch = originalFetch;
	Date.now = originalNow;
});

const candidate = {
	title: 'Lost update',
	file: 'a.ts',
	line: 1,
	claim: 'Concurrent writes race',
	evidence: 'read then write'
};

const checkpoint = JSON.stringify({
	examined: ['a.ts'],
	candidates: [candidate],
	facts: ['writes race'],
	openLeads: ['check locking'],
	next: 'inspect caller'
});

const request = JSON.stringify({ actions: [{ action: 'readDiff', path: 'a.ts' }] });
const final = JSON.stringify({ done: true });

function options(
	overrides: Partial<JsonAgentOptions<Record<string, unknown>>> = {}
): JsonAgentOptions<Record<string, unknown>> {
	const evidence = new EvidenceStore(null, buildInventory(''), 12000);

	evidence.executeRound = async () => [{ action: 'readDiff', ok: true, content: 'e'.repeat(5000), truncated: false }];

	return {
		label: 'test',
		stage: 'reviewer',
		system: 'Review carefully.',
		user: 'Opening brief.',
		config: { model: 'test', baseUrl: 'https://model.test', apiKey: 'test', contextWindow: 16000 },
		budget: new ModelBudget(100, 0),
		evidence,
		maxTurns: 30,
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 300000,
		parse: (raw) => (raw && typeof raw === 'object' && 'done' in raw ? (raw as Record<string, unknown>) : null),
		...overrides
	};
}

function model(reply: (messages: ChatMessage[], call: number) => string | Promise<string>): ChatMessage[][] {
	const prompts: ChatMessage[][] = [];

	globalThis.fetch = (async (_url, init) => {
		const { messages } = JSON.parse(init?.body as string) as { messages: ChatMessage[] };

		prompts.push(messages);

		return Response.json({ choices: [{ message: { content: await reply(messages, prompts.length) } }] });
	}) as typeof fetch;

	return prompts;
}

function isCheckpoint(messages: ChatMessage[]): boolean {
	return messages.at(-1)?.content.includes(CHECKPOINT_REQUEST) ?? false;
}

test('a transcript under the threshold keeps its entire prefix without checkpoint calls', async () => {
	const prompts = model((_messages, call) => (call === 1 ? request : final));

	await runJsonAgent(options());

	expect(prompts).toHaveLength(2);
	expect(prompts[1]?.slice(0, 2)).toEqual(prompts[0]);
	expect(prompts.some(isCheckpoint)).toBe(false);
});

test('checkpoint rebuild preserves opening bytes, recent rounds, discussion and candidates into the result', async () => {
	let rebuilt: ChatMessage[] | undefined;

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) return checkpoint;

		if (messages.some((message) => message.content.startsWith('Checkpoint of your work so far:'))) {
			rebuilt = messages;

			const summary = messages.find((message) => message.content.startsWith('Checkpoint of your work so far:'));
			const saved = JSON.parse(summary?.content.split('\n').slice(1).join('\n') ?? '{}');

			return JSON.stringify({ done: true, candidates: saved.candidates });
		}

		return request;
	});

	const result = await runJsonAgent(options({ getDiscussion: async () => 'Check concurrency.' }));
	const before = prompts.find(isCheckpoint);

	expect(rebuilt?.slice(0, 2)).toEqual(prompts[0]?.slice(0, 2));
	expect(rebuilt?.slice(-4)).toEqual(before?.slice(-5, -1));
	expect(rebuilt?.some((message) => message.content.includes('Check concurrency.'))).toBe(true);
	expect(rebuilt?.[2]?.content).toContain(checkpoint);
	expect(result.value?.candidates).toEqual([candidate]);
});

test('invalid checkpoint gets one repair then stubs below threshold and keeps that prefix on the next call', async () => {
	let invalid = 0;
	let fallback: ChatMessage[] | undefined;

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) {
			invalid++;

			return 'invalid';
		}

		if (messages.some((message) => message.content.startsWith('[Earlier tool output removed'))) {
			if (fallback) return final;
			fallback = messages;
		}

		return request;
	});

	await runJsonAgent(options());

	expect(invalid).toBe(2);
	expect(fallback?.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThan(48000);
	expect(prompts.at(-1)?.slice(0, fallback?.length)).toEqual(fallback);
});

test('the final turn never spends a checkpoint call', async () => {
	const prompts = model((_messages, call) => (call <= 10 ? request : final));

	await runJsonAgent(options({ maxTurns: 11 }));

	expect(prompts).toHaveLength(11);
	expect(prompts.some(isCheckpoint)).toBe(false);
});

test('an agent attempts no more than three checkpoints even as its transcript grows again', async () => {
	let checkpoints = 0;

	model((messages) => {
		if (isCheckpoint(messages)) {
			checkpoints++;

			return checkpoint;
		}

		return messages.at(-1)?.content.startsWith('This is your final turn.') ? final : request;
	});

	await runJsonAgent(options({ maxTurns: 45 }));

	expect(checkpoints).toBe(MAX_CHECKPOINTS);
});

test('small windows reduce tool output and large windows retain the existing round cap', () => {
	expect(contextBudget(16000).toolRoundChars).toBe(5120);
	expect(contextBudget(128000).toolRoundChars).toBe(24000);
	expect(contextBudget(1000000).toolRoundChars).toBe(24000);
});

test('abort during a checkpoint stops without another model call and charges the interrupted call', async () => {
	const abort = new AbortController();
	const opts = options({ signal: abort.signal });

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) {
			abort.abort();
			throw new Error('cancelled');
		}

		return request;
	});

	await expect(runJsonAgent(opts)).rejects.toBeInstanceOf(ReviewAbortedError);
	expect(isCheckpoint(prompts.at(-1) ?? [])).toBe(true);
	expect(opts.budget.used).toBe(prompts.length);
});

test('pausing a checkpoint refunds the interrupted call and resumes the same appended request', async () => {
	const control = new ReviewControl();
	const opts = options({ signal: control.abort.signal });
	let paused = false;

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) {
			if (!paused) {
				paused = true;
				control.pause();
				queueMicrotask(() => control.resume());
				throw new Error('paused');
			}

			return checkpoint;
		}

		return paused ? final : request;
	});

	await runWithReviewControl(control, () => runJsonAgent(opts));

	const checkpoints = prompts.filter(isCheckpoint);

	expect(checkpoints).toHaveLength(2);
	expect(checkpoints[0]).toEqual(checkpoints[1]);
	expect(opts.budget.used).toBe(prompts.length - 1);
});

test('a valid checkpoint repair replaces the transcript after exactly two charged calls', async () => {
	let attempts = 0;
	const opts = options();

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) return ++attempts === 1 ? '{"examined":[]}' : checkpoint;

		return attempts === 2 ? final : request;
	});

	await runJsonAgent(opts);

	expect(attempts).toBe(2);
	expect(prompts.at(-1)?.[2]?.content).toContain(checkpoint);
	expect(opts.budget.used).toBe(prompts.length);
});

test('a checkpoint preserves the final budget call and forces that call to answer', async () => {
	const budget = new ModelBudget(12, 0);

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) return 'invalid';

		return messages.at(-1)?.content.startsWith('This is your final turn.') ? final : request;
	});

	const result = await runJsonAgent(options({ budget }));

	expect(result.value).toEqual({ done: true });
	expect(prompts.filter(isCheckpoint)).toHaveLength(1);
	expect(budget.used).toBe(12);
});

test('rebuilding retains schema repair messages and synchronizes the tool-result references', () => {
	const opening: ChatMessage[] = [
		{ role: 'system', content: 'system' },
		{ role: 'user', content: 'brief' }
	];

	const results: ChatMessage[] = [];
	const messages = [...opening];

	for (let index = 0; index < 4; index++) {
		const result: ChatMessage = { role: 'user', content: `evidence ${index}` };

		messages.push({ role: 'assistant', content: request }, result);
		results.push(result);
	}

	const repairs: ChatMessage[] = [
		{ role: 'assistant', content: 'bad json' },
		{ role: 'user', content: 'repair schema' }
	];

	messages.push(...repairs);

	expect(applyCheckpoint(messages, results, checkpoint)).toBe(true);
	expect(messages.slice(3, 5)).toEqual(repairs);
	expect(results).toHaveLength(2);
	expect(messages.at(-1)).toBe(results[1]);
	expect(messages.at(-3)).toBe(results[0]);
});

test('a checkpoint that reaches the deadline cannot launch another call', async () => {
	const now = Date.now();
	let elapsed = 0;

	Date.now = () => now + elapsed;

	const opts = options({ consumeReserve: true, deadlineAt: now + 60000 });

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) {
			elapsed = 60001;

			return checkpoint;
		}

		return request;
	});

	const result = await runJsonAgent(opts);

	expect(result.value).toBeNull();
	expect(result.error).toContain('deadline');
	expect(isCheckpoint(prompts.at(-1) ?? [])).toBe(true);
	expect(opts.budget.used).toBe(prompts.length);
});

test('time spent checkpointing can force the next ordinary call to be the final turn', async () => {
	const now = Date.now();
	let elapsed = 0;

	Date.now = () => now + elapsed;

	const prompts = model((messages) => {
		if (isCheckpoint(messages)) {
			elapsed = 1001;

			return checkpoint;
		}

		return elapsed ? final : request;
	});

	const result = await runJsonAgent(options({ timeLimit: { finalTurnAfterMs: 1000, maxWallMs: 60000 } }));

	expect(result.value).toEqual({ done: true });
	expect(prompts.at(-1)?.at(-1)?.content).toStartWith('This is your final turn.');
});

test('retrieval actually truncates a round to the selected model window', async () => {
	const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+${'x'.repeat(30000)}
`;

	const sizes: number[] = [];

	for (const contextWindow of [16000, 128000, 1000000]) {
		const opts = options();

		opts.config.contextWindow = contextWindow;
		opts.evidence = new EvidenceStore(null, buildInventory(diff), 40000);

		const results = await executeTurn(opts, [{ action: 'readDiff', path: 'a.ts' }], 'test-agent');

		sizes.push(results.reduce((sum, result) => sum + result.content.length, 0));
	}

	expect(sizes).toEqual([5120, 24000, 24000]);
});

test('a rejected checkpoint request falls back without charging a repair call', async () => {
	let rejected = 0;
	const opts = options();

	const prompts = model((messages) =>
		messages.some((message) => message.content.startsWith('[Earlier tool output removed')) ? final : request
	);

	const reply = globalThis.fetch;

	globalThis.fetch = (async (url, init) => {
		const { messages } = JSON.parse(init?.body as string) as { messages: ChatMessage[] };

		if (isCheckpoint(messages)) {
			rejected++;

			return Response.json({ error: { message: 'Checkpoint request rejected' } }, { status: 400 });
		}

		return reply(url, init);
	}) as typeof fetch;

	const result = await runJsonAgent(opts);

	expect(result.value).toEqual({ done: true });
	expect(rejected).toBe(1);
	expect(opts.budget.used).toBe(prompts.length + rejected);
});
