import { afterEach, expect, test } from 'bun:test';
import { chatCompletion } from '../../../src/models/llm';
import { settleOnClock, useFakeClock } from '../../helpers/fake-clock';
import { fetchUntilAborted } from '../../helpers/fetch';

useFakeClock();

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test('a call bounded only by its caller’s clock fails as the caller out of time, not as a timed-out request', async () => {
	globalThis.fetch = fetchUntilAborted;

	const call = chatCompletion({
		baseUrl: 'https://model.test',
		apiKey: '',
		model: 'm',
		messages: [{ role: 'user', content: 'hi' }],
		settleBy: Date.now() + 200_000
	});

	const failure = await settleOnClock(
		call.catch((error: unknown) => error),
		1_000,
		10 * 60_000
	);

	expect(failure).toMatchObject({ message: 'Model request stopped: its caller ran out of time' });
});
