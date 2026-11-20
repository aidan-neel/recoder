import { expect, jest, test } from 'bun:test';
import { withDevinRetries } from '../../../src/agents/devin/devin-retry';
import { settleOnClock, useFakeClock } from '../../helpers/fake-clock';

useFakeClock();

test.each([
	'Reached request rate limit. Your limit will reset in 2 seconds (at 04:17 UTC).',
	'HTTP 429 Too Many Requests\nRetry-After: 2',
	'HTTP 429\n{"retry_after":2}',
	'HTTP 429\n{"retry_after":2,"error":"slow"}'
])('waits for a reset hint before retrying a transient failure: %s', async (errorOutput) => {
	const calls: number[] = [];

	const run = withDevinRetries(new AbortController().signal, async () => {
		calls.push(Date.now());

		return calls.length === 1 ? { value: 'failed', errorOutput } : { value: 'done' };
	});

	expect(await settleOnClock(run, 500, 10_000)).toBe('done');
	expect(calls).toHaveLength(2);
	expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(3000);
});

test('honors an absolute Retry-After date and does not retry an hours-long reset early', async () => {
	jest.setSystemTime(new Date('2026-11-20T00:00:00Z'));

	let calls = 0;

	const work = withDevinRetries(new AbortController().signal, async () => ({
		value: ++calls,
		errorOutput: calls === 1 ? 'HTTP 429\nRetry-After: Fri, 20 Nov 2026 00:00:02 GMT' : undefined
	}));

	expect(await settleOnClock(work, 500, 10_000)).toBe(2);

	const attempt = jest.fn(async () => ({
		value: 'limited',
		errorOutput: 'Reached request rate limit. Reset in 3 hours.'
	}));

	expect(await withDevinRetries(new AbortController().signal, attempt)).toBe('limited');
	expect(attempt).toHaveBeenCalledTimes(1);
});

test('uses bounded exponential backoff without a hint, then returns the final failure', async () => {
	const calls: number[] = [];

	const run = withDevinRetries(new AbortController().signal, async () => {
		calls.push(Date.now());

		return { value: 'limited', errorOutput: 'Reached request rate limit' };
	});

	expect(await settleOnClock(run, 1000, 60_000)).toBe('limited');
	expect(calls).toHaveLength(4);
	expect(calls.slice(1).map((at, i) => at - calls[i])).toEqual([5000, 10000, 20000]);
});

test.each(['Not logged in', 'HTTP 429 quota exhausted', '', 'boom'])(
	'does not retry non-throttles: %s',
	async (errorOutput) => {
		const attempt = jest.fn(async () => ({ value: 'failed', errorOutput }));

		expect(await withDevinRetries(new AbortController().signal, attempt)).toBe('failed');
		expect(attempt).toHaveBeenCalledTimes(1);
	}
);

test('does not replay a partial answer even when the CLI subsequently hits a rate limit', async () => {
	const attempt = jest.fn(async () => ({ value: 'partial', errorOutput: 'HTTP 429', partial: true }));

	expect(await withDevinRetries(new AbortController().signal, attempt)).toBe('partial');
	expect(attempt).toHaveBeenCalledTimes(1);
});

test('cancellation or the caller deadline interrupts backoff without another CLI invocation', async () => {
	const controller = new AbortController();
	const attempt = jest.fn(async () => ({ value: 'limited', errorOutput: 'HTTP 429' }));
	const work = withDevinRetries(controller.signal, attempt).catch((error: Error) => error.message);

	setTimeout(() => controller.abort(), 1000);
	expect(await settleOnClock(work, 500, 10_000)).toBe('Model request cancelled');
	expect(attempt).toHaveBeenCalledTimes(1);
});
