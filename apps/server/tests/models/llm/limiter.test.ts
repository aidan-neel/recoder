import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { CapacityError, LlmError, isRateLimitError } from '../../../src/models/llm/errors';
import {
	acquireLlmSlot,
	llmEndpoint,
	recordLlmRateLimit,
	recordLlmSuccess,
	releaseLlmSlot,
	resetLlmLimiter
} from '../../../src/models/llm/limiter';

const savedConcurrency = process.env.RECODER_LLM_CONCURRENCY;

const A = 'https://a.example/v1';

const B = 'https://b.example/v1';

const START = new Date('2026-01-01T00:00:00Z').getTime();

/** Moves the clock past the backoff cooldown. */
function afterCooldown(times = 1): void {
	setSystemTime(new Date(START + times * 10_000));
}

/** Takes slots until one would have to wait, and returns how many were free. */
async function freeSlots(max: number, endpoint = A): Promise<number> {
	let taken = 0;

	for (; taken < max; taken++) {
		const outcome = await acquireLlmSlot(endpoint, undefined, 5).then(
			() => 'granted',
			(err) => (err instanceof CapacityError ? 'full' : 'error')
		);

		if (outcome !== 'granted') break;
	}

	for (let i = 0; i < taken; i++) releaseLlmSlot(A);

	return taken;
}

beforeEach(() => {
	setSystemTime(new Date(START));
	resetLlmLimiter();
	process.env.RECODER_LLM_CONCURRENCY = '16';
});

afterEach(() => {
	resetLlmLimiter();
	setSystemTime();

	if (savedConcurrency === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
	else process.env.RECODER_LLM_CONCURRENCY = savedConcurrency;
});

describe('adaptive llm limiter', () => {
	test('defaults the ceiling to 64 slots', async () => {
		delete process.env.RECODER_LLM_CONCURRENCY;

		expect(await freeSlots(100)).toBe(64);
	});

	test('a rate limit halves the limit', async () => {
		recordLlmRateLimit(A);

		expect(await freeSlots(100)).toBe(8);

		afterCooldown();
		recordLlmRateLimit(A);

		expect(await freeSlots(100)).toBe(4);
	});

	test('rate limits within the cooldown cut the limit once', async () => {
		for (let i = 0; i < 10; i++) recordLlmRateLimit(A);

		expect(await freeSlots(100)).toBe(8);
	});

	test('the limit never drops below 4', async () => {
		for (let i = 0; i < 6; i++) {
			afterCooldown(i);
			recordLlmRateLimit(A);
		}

		expect(await freeSlots(100)).toBe(4);
	});

	test('a ceiling under the floor stays the limit', async () => {
		process.env.RECODER_LLM_CONCURRENCY = '2';
		recordLlmRateLimit(A);

		expect(await freeSlots(100)).toBe(2);
	});

	test('held slots stay held and nobody new is granted until active drops under the lowered limit', async () => {
		for (let i = 0; i < 16; i++) await acquireLlmSlot(A);

		recordLlmRateLimit(A);

		let granted = false;

		const waiter = acquireLlmSlot(A).then(() => {
			granted = true;
		});

		for (let i = 0; i < 8; i++) releaseLlmSlot(A);

		await Promise.resolve();

		expect(granted).toBe(false);

		releaseLlmSlot(A);
		await waiter;

		expect(granted).toBe(true);
	});

	test('waiters are granted in arrival order as slots free up', async () => {
		process.env.RECODER_LLM_CONCURRENCY = '1';
		await acquireLlmSlot(A);

		const order: number[] = [];
		const waiters = [1, 2, 3].map((n) => acquireLlmSlot(A).then(() => order.push(n)));

		releaseLlmSlot(A);
		await waiters[0];
		releaseLlmSlot(A);
		await waiters[1];
		releaseLlmSlot(A);
		await waiters[2];

		expect(order).toEqual([1, 2, 3]);
	});

	test('a waiter is granted when successes raise the limit', async () => {
		for (let i = 0; i < 16; i++) await acquireLlmSlot(A);

		recordLlmRateLimit(A);

		for (let i = 0; i < 8; i++) releaseLlmSlot(A);

		const waiter = acquireLlmSlot(A);

		afterCooldown();
		recordLlmSuccess(A);

		await waiter;
	});

	test('successes during the cooldown leave the limit cut', async () => {
		recordLlmRateLimit(A);

		for (let i = 0; i < 20; i++) recordLlmSuccess(A);

		expect(await freeSlots(100)).toBe(8);
	});

	test('each success after the cooldown raises the limit by one', async () => {
		recordLlmRateLimit(A);
		afterCooldown();
		recordLlmSuccess(A);

		expect(await freeSlots(100)).toBe(9);

		recordLlmSuccess(A);

		expect(await freeSlots(100)).toBe(10);
	});

	test('successes recover the limit up to the ceiling and no further', async () => {
		recordLlmRateLimit(A);
		afterCooldown();

		for (let i = 0; i < 100; i++) recordLlmSuccess(A);

		expect(await freeSlots(100)).toBe(16);
	});
});

describe('per-endpoint limiter', () => {
	test('a rate limit on one endpoint leaves another endpoint at its ceiling', async () => {
		recordLlmRateLimit(A);

		expect(await freeSlots(100, A)).toBe(8);
		expect(await freeSlots(100, B)).toBe(16);
	});

	test("one endpoint's successes do not restore another's limit", async () => {
		recordLlmRateLimit(A);
		recordLlmRateLimit(B);
		afterCooldown();

		for (let i = 0; i < 3; i++) recordLlmSuccess(B);

		expect(await freeSlots(100, A)).toBe(8);
		expect(await freeSlots(100, B)).toBe(11);
	});

	test('a waiter queued on one endpoint is not granted by a release on another', async () => {
		process.env.RECODER_LLM_CONCURRENCY = '1';
		await acquireLlmSlot(A);
		await acquireLlmSlot(B);

		let granted = false;

		const waiter = acquireLlmSlot(A).then(() => {
			granted = true;
		});

		releaseLlmSlot(B);
		await Promise.resolve();

		expect(granted).toBe(false);

		releaseLlmSlot(A);
		await waiter;

		expect(granted).toBe(true);
	});

	test('urls differing only by trailing slashes or host case share one endpoint', () => {
		expect(llmEndpoint({ baseUrl: 'HTTPS://API.Example.com/v1//' })).toBe(
			llmEndpoint({ baseUrl: 'https://api.example.com/v1' })
		);
	});

	test('a call without a base url is keyed by its provider', () => {
		expect(llmEndpoint({ baseUrl: '', provider: 'codex' })).toBe('codex');
	});
});

describe('rate limit classification', () => {
	test('429, 529 and overloaded errors are rate limits', () => {
		expect(isRateLimitError(new LlmError(429, 'slow down'), 'openai-compatible')).toBe(true);
		expect(isRateLimitError(new LlmError(529, 'x'), 'opencode')).toBe(true);
		expect(isRateLimitError(new LlmError(0, 'Provider is overloaded'), 'opencode')).toBe(true);
	});

	test("ChatGPT's and OpenCode's final 429s and other failures are not rate limits", () => {
		expect(isRateLimitError(new LlmError(429, 'usage cap'), 'codex')).toBe(false);
		expect(isRateLimitError(new LlmError(429, 'plan spent'), 'opencode')).toBe(false);
		expect(isRateLimitError(new LlmError(500, 'boom'), 'openai-compatible')).toBe(false);
		expect(isRateLimitError(new Error('429'), 'openai-compatible')).toBe(false);
	});
});
