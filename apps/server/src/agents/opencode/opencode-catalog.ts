import { z } from 'zod';
import {
	REASONING_EFFORTS,
	type AgentAuthMethod,
	type AgentAuthPrompt,
	type AgentProvider,
	type ModelEntry,
	type ReasoningEffort
} from '@recoder/shared';
import { OpenCodeError } from './opencode-error';

/** Prefix for registry ids of OpenCode models: `opencode:<provider>/<model>`. */
export const OPENCODE_MODEL_PREFIX = 'opencode:';

/** One entry per provider OpenCode knows, for the Add provider list. */
export interface CatalogProvider {
	id: string;
	name: string;
	modelCount: number;
}

const conditionSchema = z.object({ key: z.string(), op: z.enum(['eq', 'neq']), value: z.string() });

const promptSchema = z.union([
	z.object({
		type: z.literal('text'),
		key: z.string(),
		message: z.string(),
		placeholder: z.string().optional(),
		when: conditionSchema.optional()
	}),
	z.object({
		type: z.literal('select'),
		key: z.string(),
		message: z.string(),
		options: z.array(z.object({ label: z.string(), value: z.string(), hint: z.string().optional() })),
		when: conditionSchema.optional()
	})
]);

const methodSchema = z.object({
	type: z.enum(['oauth', 'api']),
	label: z.string(),
	prompts: z.array(z.unknown()).optional()
});

const authMethodsSchema = z.record(z.string(), z.array(z.unknown()));

const modelSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().optional(),
		status: z.string().optional(),
		limit: z.object({ context: z.number().optional() }).partial().optional(),
		capabilities: z
			.object({ reasoning: z.boolean().optional(), toolcall: z.boolean().optional() })
			.partial()
			.optional(),
		variants: z.record(z.string(), z.unknown()).optional()
	})
	.passthrough();

const providerSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().optional(),
		source: z.string().optional(),
		env: z.array(z.string()).optional(),
		models: z.record(z.string(), z.unknown()).optional()
	})
	.passthrough();

const providerListSchema = z.object({ all: z.array(z.unknown()) });
const configProvidersSchema = z.object({ providers: z.array(z.unknown()) });

type ConnectedProvider = z.infer<typeof providerSchema>;

/** One sign-in prompt from OpenCode's JSON, or nothing when it is malformed. */
function parsePrompt(raw: unknown): AgentAuthPrompt[] {
	const prompt = promptSchema.safeParse(raw);

	if (!prompt.success) return [];

	const when = prompt.data.when ?? null;

	if (prompt.data.type === 'text') {
		return [
			{
				type: 'text',
				key: prompt.data.key,
				message: prompt.data.message,
				placeholder: prompt.data.placeholder ?? null,
				when
			}
		];
	}

	return [
		{
			type: 'select',
			key: prompt.data.key,
			message: prompt.data.message,
			options: prompt.data.options.map((o) => ({ label: o.label, value: o.value, hint: o.hint ?? null })),
			when
		}
	];
}

/** A provider's sign-in methods, keeping each method's index in OpenCode's list. */
function parseMethods(raw: unknown[]): AgentAuthMethod[] {
	return raw.flatMap((item, index) => {
		const method = methodSchema.safeParse(item);

		if (!method.success) return [];

		const prompts = (method.data.prompts ?? []).flatMap(parsePrompt);

		return [{ index, type: method.data.type, label: method.data.label, prompts }];
	});
}

/** Models a review can use: active and able to call tools. */
function usableModels(raw: Record<string, unknown> | undefined): z.infer<typeof modelSchema>[] {
	return Object.values(raw ?? {}).flatMap((item) => {
		const model = modelSchema.safeParse(item);

		if (!model.success) return [];
		if (model.data.status && model.data.status !== 'active') return [];
		if (model.data.capabilities?.toolcall === false) return [];

		return [model.data];
	});
}

/** `/provider` (every provider OpenCode knows, ~6 MB) → names and model counts. Drops everything else, keys included. */
export function normalizeCatalog(providerJson: unknown): CatalogProvider[] {
	const list = providerListSchema.safeParse(providerJson);

	if (!list.success) throw new OpenCodeError('OpenCode returned a provider list Recoder could not read.');

	return list.data.all.flatMap((item) => {
		const provider = providerSchema.safeParse(item);

		if (!provider.success) return [];

		return [
			{
				id: provider.data.id,
				name: provider.data.name || provider.data.id,
				modelCount: usableModels(provider.data.models).length
			}
		];
	});
}

/** Connected providers from `/config/providers`. Its entries carry stored keys; only id, name, source and models are read. */
function connectedProviders(configJson: unknown): ConnectedProvider[] {
	const list = configProvidersSchema.safeParse(configJson);

	if (!list.success) throw new OpenCodeError('OpenCode returned a provider list Recoder could not read.');

	return list.data.providers.flatMap((item) => {
		const provider = providerSchema.safeParse(item);

		return provider.success ? [provider.data] : [];
	});
}

/**
 * How a connected provider signed in. OpenCode's `api` source is a key saved
 * through OpenCode; `custom` is a plugin's login (OAuth) or a built-in free tier.
 */
function connectionKind(live: ConnectedProvider | undefined, methods: AgentAuthMethod[]): AgentProvider['via'] {
	if (!live) return null;
	if (live.source === 'api') return 'key';
	if (live.source === 'config') return 'config';
	if (live.source === 'env') return 'env';

	return methods.some((m) => m.type === 'oauth') ? 'oauth' : 'builtin';
}

/**
 * The catalog, what's connected and how, and each provider's sign-in methods →
 * the list Recoder shows. Providers from the agent's own config may be missing
 * from the catalog, so they are added with no model count.
 */
export function normalizeProviders(
	catalog: CatalogProvider[],
	configJson: unknown,
	authJson: unknown
): AgentProvider[] {
	const auth = authMethodsSchema.safeParse(authJson);
	const methodsById = auth.success ? auth.data : {};
	const connected = new Map(connectedProviders(configJson).map((p) => [p.id, p]));
	const known = new Map(catalog.map((p) => [p.id, p]));

	for (const p of connected.values())
		if (!known.has(p.id)) known.set(p.id, { id: p.id, name: p.name || p.id, modelCount: 0 });

	return [...known.values()]
		.map((entry): AgentProvider => {
			const live = connected.get(entry.id);
			const methods = parseMethods(methodsById[entry.id] ?? []);
			const via = connectionKind(live, methods);

			return {
				id: entry.id,
				name: live?.name || entry.name,
				modelCount: live ? usableModels(live.models).length : entry.modelCount,
				connected: !!live,
				via,
				removable: via === 'key' || via === 'oauth',
				methods
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

const isEffort = (value: string): value is ReasoningEffort => (REASONING_EFFORTS as readonly string[]).includes(value);

/** Variants are OpenCode's reasoning presets; the ones that name an effort level, in effort order. */
function effortsFromVariants(variants: Record<string, unknown> | undefined): ReasoningEffort[] {
	const efforts = Object.keys(variants ?? {}).filter(isEffort);

	return REASONING_EFFORTS.filter((effort) => efforts.includes(effort));
}

/** Connected providers' models as registry entries the model picker understands. */
export function normalizeModels(configJson: unknown): ModelEntry[] {
	return connectedProviders(configJson).flatMap((provider) => {
		const providerName = provider.name || provider.id;

		return usableModels(provider.models).map((model): ModelEntry => {
			const ordered = effortsFromVariants(model.variants);

			return {
				provider: 'opencode',
				source: providerName,
				id: `${OPENCODE_MODEL_PREFIX}${provider.id}/${model.id}`,
				label: model.name || model.id,
				model: `${provider.id}/${model.id}`,
				baseUrl: null,
				apiKeyPreview: null,
				...(ordered.length
					? { efforts: [...ordered], defaultEffort: ordered.includes('medium') ? 'medium' : ordered[0] }
					: {}),
				...(model.limit?.context ? { contextWindow: model.limit.context } : {})
			};
		});
	});
}
