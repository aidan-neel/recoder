import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from 'bun:test';
import { CapacityError, LlmError, isRateLimitError } from '../../../src/models/llm/errors';
import {
	acquireLlmSlot,
	llmEndpoint,
	recordLlmRateLimit,
	recordLlmSuccess,
	releaseLlmSlot,
	resetLlmLimiter
} from '../../../src/models/llm/limiter';
import { withLlmLane } from '../../../src/models/llm/lane';
import { providerError } from '../../../src/agents/opencode/opencode-error';

const savedConcurrency = process.env.RECODER_LLM_CONCURRENCY;

const savedClaudeCode = process.env.RECODER_CLAUDE_CODE_CONCURRENCY;

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

	for (let i = 0; i < taken; i++) releaseLlmSlot(endpoint);

	return taken;
}

beforeEach(() => {
	setSystemTime(new Date(START));
	resetLlmLimiter();
	process.env.RECODER_LLM_CONCURRENCY = '16';
});

afterEach(() => {
	jest.useRealTimers();
	resetLlmLimiter();
	setSystemTime();

	if (savedConcurrency === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
	else process.env.RECODER_LLM_CONCURRENCY = savedConcurrency;

	if (savedClaudeCode === undefined) delete process.env.RECODER_CLAUDE_CODE_CONCURRENCY;
	else process.env.RECODER_CLAUDE_CODE_CONCURRENCY = savedClaudeCode;
});

describe('adaptive llm limiter', () => {
	test('defaults the ceiling to 64 slots', async () => {
		delete process.env.RECODER_LLM_CONCURRENCY;

		expect(await freeSlots(100)).toBe(64);
	});

	test('Claude Code runs eight processes at once unless its own env var says otherwise, never above the shared ceiling', async () => {
		delete process.env.RECODER_CLAUDE_CODE_CONCURRENCY;

		expect(await freeSlots(100, 'claude-code')).toBe(8);

		process.env.RECODER_CLAUDE_CODE_CONCURRENCY = '12';

		expect(await freeSlots(100, 'claude-code')).toBe(12);

		process.env.RECODER_LLM_CONCURRENCY = '2';

		expect(await freeSlots(100, 'claude-code')).toBe(2);
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

/** Queues a request for a slot on `A` in `review`'s lane, and notes its name in `order` once granted. */
function queueFor(review: string, name: string, order: string[], signal?: AbortSignal): Promise<void> {
	return withLlmLane({ id: review, recordWait: () => undefined }, () =>
		acquireLlmSlot(A, signal).then(() => {
			order.push(name);
		})
	);
}

/** Frees the held slot `times` times, letting each grant settle before the next. */
async function releaseInTurn(times: number): Promise<void> {
	for (let i = 0; i < times; i++) {
		releaseLlmSlot(A);
		await Promise.resolve();
	}
}

describe('fair turns between reviews', () => {
	beforeEach(async () => {
		process.env.RECODER_LLM_CONCURRENCY = '1';
		await acquireLlmSlot(A);
	});

	test('a review queued behind a busy review is served in turn, not after all of its requests', async () => {
		const order: string[] = [];
		const busy = ['busy-1', 'busy-2', 'busy-3'].map((name) => queueFor('busy', name, order));
		const small = queueFor('small', 'small-1', order);

		await releaseInTurn(4);
		await Promise.all([...busy, small]);

		expect(order).toEqual(['busy-1', 'small-1', 'busy-2', 'busy-3']);
	});

	test('a cancelled request gives its turn to the next review', async () => {
		const order: string[] = [];
		const stop = new AbortController();
		const cancelled = queueFor('first', 'first-1', order, stop.signal);
		const next = queueFor('second', 'second-1', order);

		stop.abort();
		await expect(cancelled).rejects.toThrow('Model request cancelled');
		await releaseInTurn(1);
		await next;

		expect(order).toEqual(['second-1']);
	});

	test('a request still waiting at its timeout fails with a capacity error and leaves the queue', async () => {
		jest.useFakeTimers();

		const order: string[] = [];

		const late = withLlmLane({ id: 'late', recordWait: () => undefined }, () => acquireLlmSlot(A, undefined, 1000));

		const patient = queueFor('patient', 'patient-1', order);

		jest.advanceTimersByTime(1000);
		await expect(late).rejects.toBeInstanceOf(CapacityError);
		await releaseInTurn(1);
		await patient;

		expect(order).toEqual(['patient-1']);
	});

	test('each request tells its lane how long it waited for a slot', async () => {
		jest.useFakeTimers();

		const waits: number[] = [];
		const lane = { id: 'review', recordWait: (waitedMs: number) => waits.push(waitedMs) };

		releaseLlmSlot(A);
		await withLlmLane(lane, () => acquireLlmSlot(A));

		const queued = withLlmLane(lane, () => acquireLlmSlot(A));

		jest.advanceTimersByTime(2500);
		releaseLlmSlot(A);
		await queued;

		expect(waits).toEqual([0, 2500]);
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
		expect(isRateLimitError(providerError(429, 'plan spent'), 'opencode')).toBe(false);
		expect(isRateLimitError(new LlmError(500, 'boom'), 'openai-compatible')).toBe(false);
		expect(isRateLimitError(new Error('429'), 'openai-compatible')).toBe(false);
	});
});
