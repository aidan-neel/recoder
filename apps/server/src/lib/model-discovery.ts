import type { DiscoveredModel } from '@recoder/shared';

/**
 * `GET {baseUrl}/models` on an OpenAI-compatible endpoint. vLLM reports the
 * context window as `max_model_len`; OpenRouter and others use
 * `context_length` / `context_window`. A base URL missing its `/v1` is
 * corrected, and the working one is returned so the UI can save it.
 */
export async function discoverModels(baseUrl: string, apiKey?: string): Promise<{ baseUrl: string; models: DiscoveredModel[] }> {
	const base = baseUrl.trim().replace(/\/+$/, '');
	const candidates = /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
	let lastError = '';
	for (const candidate of candidates) {
		let response: Response;
		try {
			response = await fetch(`${candidate}/models`, {
				headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
				signal: AbortSignal.timeout(10_000)
			});
		} catch (err) {
			const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
			throw new Error(`Couldn't reach ${new URL(candidate).host}: ${cause}`);
		}
		if (response.status === 401 || response.status === 403) throw new Error(`The endpoint rejected the API key (${response.status}).`);
		if (!response.ok) {
			lastError = `${candidate}/models returned ${response.status}`;
			continue;
		}
		const body = (await response.json().catch(() => null)) as { data?: unknown } | unknown[] | null;
		const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : null;
		if (!rows) {
			lastError = `${candidate}/models did not return a model list`;
			continue;
		}
		const models = rows.flatMap((raw): DiscoveredModel[] => {
			const row = raw as Record<string, unknown>;
			if (typeof row.id !== 'string' || !row.id) return [];
			const window = [row.max_model_len, row.context_length, row.context_window, (row.top_provider as Record<string, unknown> | undefined)?.context_length]
				.find((value) => typeof value === 'number' && value > 0) as number | undefined;
			return [{ id: row.id, contextWindow: window ?? null, ownedBy: typeof row.owned_by === 'string' ? row.owned_by : null }];
		});
		return { baseUrl: candidate, models };
	}
	throw new Error(lastError || 'The endpoint did not return a model list.');
}
