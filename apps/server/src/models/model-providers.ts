import { REASONING_EFFORTS, type CatalogModel, type ReasoningEffort } from '@recoder/shared';
import { TtlCache } from '../util/ttl-cache.js';

/**
 * Hosted model providers you connect with an API key. Every one speaks
 * OpenAI-compatible chat completions at `baseUrl`; what differs is how a key is
 * checked and where the model list comes from.
 */
export interface HostedProviderDef {
	id: string;
	name: string;
	blurb: string;
	baseUrl: string;
	keyUrl: string;
	usageUrl: string | null;
	/** Where the model list comes from. */
	catalog: { kind: 'models.dev'; id: string } | { kind: 'openrouter' };
	/** How a pasted key is checked without spending anything. */
	verify: { kind: 'probe'; model: string } | { kind: 'get'; path: string };
}

export const HOSTED_PROVIDERS: HostedProviderDef[] = [
	{
		id: 'opencode-go',
		name: 'OpenCode Go',
		blurb: 'Open models like GLM, Kimi and DeepSeek on a monthly plan.',
		baseUrl: 'https://opencode.ai/zen/go/v1',
		keyUrl: 'https://opencode.ai/auth',
		usageUrl: 'https://opencode.ai/auth',
		catalog: { kind: 'models.dev', id: 'opencode-go' },
		verify: { kind: 'probe', model: 'glm-5.2' }
	},
	{
		id: 'opencode',
		name: 'OpenCode Zen',
		blurb: 'Pay-as-you-go models curated by OpenCode, including free ones.',
		baseUrl: 'https://opencode.ai/zen/v1',
		keyUrl: 'https://opencode.ai/auth',
		usageUrl: 'https://opencode.ai/auth',
		catalog: { kind: 'models.dev', id: 'opencode' },
		verify: { kind: 'probe', model: 'glm-5' }
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		blurb: 'Hundreds of models from every lab behind one key.',
		baseUrl: 'https://openrouter.ai/api/v1',
		keyUrl: 'https://openrouter.ai/settings/keys',
		usageUrl: 'https://openrouter.ai/settings/credits',
		catalog: { kind: 'openrouter' },
		verify: { kind: 'get', path: '/key' }
	}
];

export function hostedProvider(id: string | undefined): HostedProviderDef | undefined {
	return id ? HOSTED_PROVIDERS.find((provider) => provider.id === id) : undefined;
}

/** The key was refused; anything else (a 400 for the empty probe) means it was accepted. */
export class KeyRejectedError extends Error {}

/** Check a key with a request that can't run a model: an empty chat, or a free account endpoint. */
export async function verifyKey(provider: HostedProviderDef, apiKey: string): Promise<void> {
	const headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
	let response: Response;

	try {
		response =
			provider.verify.kind === 'probe'
				? await fetch(`${provider.baseUrl}/chat/completions`, {
						method: 'POST',
						headers,
						body: JSON.stringify({ model: provider.verify.model, messages: [] }),
						signal: AbortSignal.timeout(15_000)
					})
				: await fetch(`${provider.baseUrl}${provider.verify.path}`, { headers, signal: AbortSignal.timeout(15_000) });
	} catch (err) {
		throw new Error(`Couldn't reach ${provider.name}: ${err instanceof Error ? err.message : String(err)}`, {
			cause: err
		});
	}

	if (response.status === 401 || response.status === 403)
		throw new KeyRejectedError(`${provider.name} didn't accept that key.`);
	if (response.status >= 500) throw new Error(`${provider.name} returned ${response.status}. Try again.`);
}

/** Model packages on models.dev that mean plain chat completions. */
const CHAT_COMPLETIONS = new Set(['@ai-sdk/openai-compatible']);

/**
 * One provider's models from models.dev's `api.json`. A model with its own
 * `provider.npm` other than the OpenAI-compatible one is served over another API
 * (Responses, Anthropic Messages) and is marked unsupported.
 */
export function parseModelsDev(body: unknown, providerId: string): CatalogModel[] {
	const provider = (body as Record<string, unknown> | null)?.[providerId] as Record<string, unknown> | undefined;
	const models = provider?.models;

	if (!models || typeof models !== 'object') return [];

	const providerNpm = typeof provider.npm === 'string' ? provider.npm : '@ai-sdk/openai-compatible';

	return Object.entries(models as Record<string, Record<string, unknown>>).flatMap(([key, raw]): CatalogModel[] => {
		if (!raw || typeof raw !== 'object') return [];

		const id = typeof raw.id === 'string' ? raw.id : key;
		const override = (raw.provider as Record<string, unknown> | undefined)?.npm;
		const npm = typeof override === 'string' ? override : providerNpm;
		const context = (raw.limit as Record<string, unknown> | undefined)?.context;
		const input = (raw.cost as Record<string, unknown> | undefined)?.input;

		return [
			{
				id,
				name: typeof raw.name === 'string' && raw.name ? raw.name : id,
				contextWindow: typeof context === 'number' && context > 0 ? context : null,
				inputCost: typeof input === 'number' ? input : null,
				supported: CHAT_COMPLETIONS.has(npm)
			}
		];
	});
}

/** Known effort words in Recoder's order (lowest first); anything else is dropped. */
function efforts(raw: unknown): ReasoningEffort[] {
	if (!Array.isArray(raw)) return [];

	const offered = new Set(raw.filter((value): value is string => typeof value === 'string'));

	return REASONING_EFFORTS.filter((effort) => offered.has(effort));
}

/** "DeepSeek: DeepSeek V4 Flash" → "DeepSeek V4 Flash"; the vendor already shows in the id. */
function displayName(name: unknown, id: string): string {
	return typeof name === 'string' && name ? name.replace(/^[^:]{1,40}:\s+/, '') : id;
}

/**
 * OpenRouter's `/models`: prices are USD per token as strings; every model
 * speaks chat completions. `reasoning.supported_efforts` lists the effort
 * levels a model takes.
 */
export function parseOpenRouter(body: unknown): CatalogModel[] {
	const rows = (body as { data?: unknown } | null)?.data;

	if (!Array.isArray(rows)) return [];

	return rows.flatMap((raw): CatalogModel[] => {
		const row = raw as Record<string, unknown>;

		if (typeof row.id !== 'string' || !row.id) return [];

		const perToken = Number((row.pricing as Record<string, unknown> | undefined)?.prompt);
		const reasoning = row.reasoning as Record<string, unknown> | undefined;
		const offered = efforts(reasoning?.supported_efforts);
		const fallback = reasoning?.default_effort;
		const defaultEffort = offered.find((effort) => effort === fallback);

		return [
			{
				id: row.id,
				name: displayName(row.name, row.id),
				contextWindow: typeof row.context_length === 'number' && row.context_length > 0 ? row.context_length : null,
				inputCost: Number.isFinite(perToken) && perToken >= 0 ? Math.round(perToken * 1_000_000 * 1000) / 1000 : null,
				supported: true,
				...(offered.length ? { efforts: offered } : {}),
				...(defaultEffort ? { defaultEffort } : {})
			}
		];
	});
}

async function getJson(url: string): Promise<unknown> {
	const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });

	if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`);

	return response.json();
}

/** Catalogs change a few times a day at most. */
const catalogCache = new TtlCache<CatalogModel[]>(60 * 60 * 1000, 20);

/** The provider's models, supported ones first, then by name. */
export function providerCatalog(provider: HostedProviderDef): Promise<CatalogModel[]> {
	return catalogCache.get(provider.id, async () => {
		const models =
			provider.catalog.kind === 'openrouter'
				? parseOpenRouter(await getJson(`${provider.baseUrl}/models`))
				: parseModelsDev(await getJson('https://models.dev/api.json'), provider.catalog.id);

		if (models.length === 0) throw new Error(`${provider.name} didn't return any models.`);

		return models.sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
	});
}
