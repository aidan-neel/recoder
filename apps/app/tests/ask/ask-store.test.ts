import { afterEach, describe, expect, mock, test } from 'bun:test';

import { useAsk } from '../../src/lib/ask/ask-store';
import { askItemOf } from '../../src/lib/ask/item';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { buildSurface } from '../../src/lib/review/surface';

const realFetch = globalThis.fetch;

const item = askItemOf(buildSurface(SAMPLE_REVIEW, []), { kind: 'decision', id: 'sample-f1' })!;

/** A discuss stream answering with these frames. */
function stream(...frames: object[]): Response {
	return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
		headers: { 'content-type': 'text/event-stream' }
	});
}

function threadOf(reviewId: string) {
	return useAsk.getState().threads[reviewId][item.key];
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('asking the reviewer', () => {
	test('a stream that fails before its first word is tried once more', async () => {
		const fetch = mock()
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce(
				stream(
					{ type: 'token', text: 'Shared ' },
					{ type: 'done', agent: 'security', model: 'm', reply: 'Shared bucket.' }
				)
			);

		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		await useAsk.getState().ask('r-retry', item, 'Why?', false);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(threadOf('r-retry').messages.at(-1)).toMatchObject({ text: 'Shared bucket.', model: 'm', state: 'done' });
	});

	test('a reply that fails partway keeps its words and is not asked again', async () => {
		const fetch = mock().mockResolvedValue(
			stream({ type: 'token', text: 'Because the ' }, { type: 'error', error: 'The reviewer did not respond.' })
		);

		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		await useAsk.getState().ask('r-partial', item, 'Why?', false);

		expect(fetch).toHaveBeenCalledTimes(1);

		expect(threadOf('r-partial').messages.at(-1)).toMatchObject({
			text: 'Because the ',
			state: 'failed',
			failure: { message: 'The reviewer did not respond.' }
		});
	});

	test('a refusal the server would repeat is shown at once instead of asked twice', async () => {
		const fetch = mock().mockResolvedValue(
			Response.json({ error: 'Pick a reviewer model in Settings → Agent.', action: 'settings' }, { status: 409 })
		);

		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		await useAsk.getState().ask('r-409', item, 'Why?', false);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(threadOf('r-409').messages.at(-1)?.failure).toMatchObject({ action: 'settings' });
	});

	test('an error frame before the first word is the server’s answer, shown at once instead of asked twice', async () => {
		const fetch = mock().mockResolvedValue(stream({ type: 'error', error: 'The model call timed out.' }));

		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		await useAsk.getState().ask('r-frame', item, 'Why?', false);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(threadOf('r-frame').messages.at(-1)?.failure?.message).toBe('The model call timed out.');
	});

	test('a question that got no full answer is left out of the history sent with the next one', async () => {
		const fetch = mock()
			.mockResolvedValueOnce(
				stream({ type: 'token', text: 'I looked at the ' }, { type: 'error', error: 'Timed out.' })
			)
			.mockResolvedValueOnce(stream({ type: 'done', agent: 'security', model: 'm', reply: 'Yes.' }))
			.mockResolvedValueOnce(stream({ type: 'done', agent: 'security', model: 'm', reply: 'No.' }));

		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		await useAsk.getState().ask('r-history', item, 'First?', false);
		await useAsk.getState().ask('r-history', item, 'Second?', false);
		await useAsk.getState().ask('r-history', item, 'Third?', false);

		const body = JSON.parse(String((fetch.mock.calls[2] as [string, RequestInit])[1].body)) as { history: unknown[] };

		expect(body.history).toEqual([
			{ role: 'user', body: 'Second?' },
			{ role: 'assistant', body: 'Yes.' }
		]);
	});
});
