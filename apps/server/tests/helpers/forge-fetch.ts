/** One request a stubbed forge saw. */
export interface ForgeCall {
	method: string;
	url: string;
	body: Record<string, unknown> | null;
}

/** The answer a stubbed forge gives a request: a status and a JSON body. */
type Reply = [number, unknown];

const realFetch = globalThis.fetch;

/**
 * Replace `fetch` with a forge that answers through `reply` and records each
 * request; `restoreFetch` puts the real one back.
 */
export function stubForge(reply: (call: ForgeCall) => Reply): ForgeCall[] {
	const calls: ForgeCall[] = [];

	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const call = {
			method: init?.method ?? 'GET',
			url: String(url),
			body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
		};

		calls.push(call);

		const [status, body] = reply(call);

		return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
	}) as typeof fetch;

	return calls;
}

export function restoreFetch(): void {
	globalThis.fetch = realFetch;
}
