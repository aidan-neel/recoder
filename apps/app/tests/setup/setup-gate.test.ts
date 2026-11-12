import { afterEach, beforeEach, expect, test } from 'bun:test';

import { useQueue } from '../../src/lib/queue/queue-store';
import { checkSetupAgain } from '../../src/lib/setup/setup-gate';
import { memoryStorage } from '../fixtures';
import { pull, repo } from '../queue/fixtures';

/** True while the server answers the setup status and the review list with an error. */
let failing = true;

/** How many times the setup status was asked for. */
let statusCalls = 0;

let stop = () => {};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The review server's answer to one request. */
function answer(path: string): Response {
	if (path === '/api/settings/status') {
		statusCalls += 1;

		return failing
			? json({ error: 'Something broke.' }, 500)
			: json({ providerConnected: true, configured: true, repoCount: 1 });
	}

	if (path === '/api/reviews') return failing ? json({ error: 'Something broke.' }, 500) : json([]);
	if (path === '/api/repos') return json([repo('r1', 'acme/api')]);
	if (path === '/api/repos/r1/pulls') return json([pull(1)]);
	if (path === '/api/reviews/progress-summaries') return json({});

	return json({ error: 'not found' }, 404);
}

/** Lets every pending fetch and state update settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
	failing = true;
	statusCalls = 0;

	Object.assign(globalThis, {
		document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
		window: new EventTarget(),
		localStorage: memoryStorage(),
		fetch: async (input: string | URL) => answer(new URL(String(input)).pathname)
	});
});

afterEach(() => stop());

test('a failed setup check runs again once the queue recovers, so its note does not outlive the failure', async () => {
	await checkSetupAgain().catch(() => undefined);
	useQueue.getState().reset();
	stop = useQueue.getState().load(false);
	await settle();

	expect(useQueue.getState().status).toBe('failed');
	expect(statusCalls).toBe(1);

	failing = false;
	await useQueue.getState().refresh();
	await settle();

	expect(useQueue.getState().status).toBe('ready');
	expect(statusCalls).toBe(2);
});
