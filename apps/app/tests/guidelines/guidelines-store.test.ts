import { afterEach, describe, expect, mock, test } from 'bun:test';

import { useGuidelines } from '../../src/lib/guidelines/guidelines-store';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function repoFile(content: string) {
	return { repoId: 'r1', path: '.recoder/REVIEW.md', ref: 'main', sha: null, content, pending: null, canPropose: true };
}

afterEach(() => {
	globalThis.fetch = realFetch;
	useGuidelines.setState({ status: 'loading', overview: null, error: null, repos: {} });
});

describe('reading a repository’s guidelines', () => {
	test('an older read that lands after a newer one is dropped', async () => {
		let releaseFirst: (response: Response) => void = () => {};

		globalThis.fetch = mock()
			.mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)))
			.mockImplementationOnce(() => Promise.resolve(json(repoFile('- after the save\n')))) as unknown as typeof fetch;

		const first = useGuidelines.getState().loadRepo('r1');

		await useGuidelines.getState().loadRepo('r1');
		releaseFirst(json(repoFile('- before the save\n')));
		await first;

		const state = useGuidelines.getState().repos.r1;

		expect(state.status === 'ready' && state.data.content).toBe('- after the save\n');
	});

	test('a retry after a failure keeps the failure on screen until the answer lands', async () => {
		globalThis.fetch = mock(() => Promise.resolve(json({ error: 'Token expired' }, 401))) as unknown as typeof fetch;
		await useGuidelines.getState().loadRepo('r1');

		let release: (response: Response) => void = () => {};

		globalThis.fetch = mock(() => new Promise<Response>((resolve) => (release = resolve))) as unknown as typeof fetch;

		const retry = useGuidelines.getState().loadRepo('r1');

		expect(useGuidelines.getState().repos.r1.status).toBe('error');
		release(json(repoFile('- ok\n')));
		await retry;
		expect(useGuidelines.getState().repos.r1.status).toBe('ready');
	});
});

describe('undoing a save of the global guidelines', () => {
	test('undo after the first save resets the layer instead of saving the defaults as a file', async () => {
		const calls: string[] = [];
		const defaults = { content: '## Focus\n- Recoder’s defaults\n', updatedAt: null };

		globalThis.fetch = mock((input: string | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET';

			calls.push(`${method} ${new URL(String(input)).pathname}`);

			return Promise.resolve(
				json(method === 'PUT' ? { content: '- Mine\n', updatedAt: '2026-10-17T00:00:00Z' } : defaults)
			);
		}) as unknown as typeof fetch;

		useGuidelines.setState({
			status: 'ready',
			overview: { global: defaults, template: '', maxChars: 8000, path: '.recoder/REVIEW.md', repos: [] }
		});

		const previous = await useGuidelines.getState().saveGlobal('- Mine\n');

		await useGuidelines.getState().restoreGlobal(previous);

		expect(calls).toEqual(['PUT /api/guidelines/global', 'DELETE /api/guidelines/global']);
		expect(useGuidelines.getState().overview?.global.updatedAt).toBeNull();
	});
});
