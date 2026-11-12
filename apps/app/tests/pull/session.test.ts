import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PullPage } from '@recoder/shared';

import type { ApiClient } from '../../src/lib/api/client';
import { createSession } from '../../src/lib/pull/session';
import { createListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';

/** The running sample review's pull request. */
const NUMBER = 216;

/** Just enough of a visible page for the checks poll. */
const VISIBLE_PAGE = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };

beforeEach(() => {
	Object.defineProperty(globalThis, 'document', { value: VISIBLE_PAGE, configurable: true });
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'document');
});

/** A session whose page read waits until the test settles it; it records each review stream opened. */
function sessionWithHeldPage() {
	const sample = createSampleApi();
	const page = Promise.withResolvers<PullPage>();
	const streams: string[] = [];

	const client: ApiClient = {
		...sample,
		pullPage: () => page.promise,
		follow: (id) => {
			streams.push(id);

			return () => {};
		}
	};

	const session = createSession(client, createListStore(client), 'sample-api', NUMBER);

	return { session, streams, settlePage: async () => page.resolve(await sample.pullPage('sample-api', NUMBER)) };
}

describe('a pull request session', () => {
	test('an open session follows the review its page names', async () => {
		const { session, streams, settlePage } = sessionWithHeldPage();
		const close = session.open();

		await settlePage();
		await session.pages.loadPage();
		close();

		expect(streams).toContain('sample-216');
	});

	test('a page that answers after the session closed opens no stream', async () => {
		const { session, streams, settlePage } = sessionWithHeldPage();

		session.open()();
		await settlePage();
		await session.pages.loadPage();

		expect(streams).toEqual([]);
	});
});
