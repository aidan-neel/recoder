/** One model a fake vLLM server lists; `len` is its `max_model_len`. */
export interface FakeVllmModel {
	id: string;
	len?: number;
}

/**
 * Replaces `fetch` with a vLLM server at `http://vllm.test:8000`. Only
 * `/v1/models` exists, as on a real server (`/models` is a 404). Change `state`
 * between calls to add or remove models, take the server down (`down`), make it
 * demand a key (`key`) or hold its answers until `release()` (`hold`).
 */
export function fakeVllm(initial: FakeVllmModel[]) {
	const real = globalThis.fetch;
	let release: () => void = () => {};

	const state = {
		models: initial,
		down: false,
		key: null as string | null,
		hold: null as Promise<void> | null,
		requests: [] as Array<{ url: string; auth: string | null }>
	};

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		const auth = new Headers(init?.headers).get('authorization');

		state.requests.push({ url, auth });

		if (!url.startsWith('http://vllm.test:8000')) return new Response('not found', { status: 404 });
		if (state.down) throw new TypeError('connection refused');

		await state.hold;

		if (state.key && auth !== `Bearer ${state.key}`) return new Response('unauthorized', { status: 401 });
		if (url !== 'http://vllm.test:8000/v1/models') return new Response('not found', { status: 404 });

		return Response.json({
			object: 'list',
			data: state.models.map((model) => ({ id: model.id, object: 'model', owned_by: 'vllm', max_model_len: model.len }))
		});
	}) as typeof fetch;

	return {
		state,
		hold(): void {
			state.hold = new Promise<void>((resolve) => (release = resolve));
		},
		release(): void {
			release();
			state.hold = null;
		},
		restore(): void {
			globalThis.fetch = real;
		}
	};
}
