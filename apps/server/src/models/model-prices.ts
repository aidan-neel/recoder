import type { ModelCost } from '@recoder/shared';
import { modelsDevCatalog, modelsDevCost } from './model-providers';

/** The price of a model by the id its calls were made with, or null when the catalog has none. */
export type PriceLookup = (model: string) => ModelCost | null;

/**
 * The labs that sell their own models. Their prices win when another provider (a reseller, a gateway) lists the same
 * model, so `claude-opus-5-5` run through the Claude Code CLI is priced as `anthropic`'s, not an aggregator's.
 */
const FIRST_PARTY_PROVIDERS = ['anthropic', 'openai', 'google', 'xai', 'deepseek', 'mistral'];

/**
 * A model id as the price index spells it: lowercase, without a provider path (`anthropic/claude-opus-4.5` and
 * `openrouter/anthropic/claude-opus-4.5` are `claude-opus-4-5`), dots as dashes, and without a trailing release
 * date or `-latest`. A moving alias such as `opus` stays as it is and matches nothing: it has no price to guess.
 */
function normalizeModelId(id: string): string {
	return id
		.toLowerCase()
		.replace(/^.*\//, '')
		.replace(/\./g, '-')
		.replace(/-(\d{8}|latest)$/, '');
}

/**
 * Prices every model on models.dev's `api.json` by its normalized id. When several providers list the same id,
 * {@link FIRST_PARTY_PROVIDERS} win, in that order, then the others in the catalog's order. A model without both an
 * input and an output price is left out.
 */
export function priceLookupFrom(body: unknown): PriceLookup {
	const providers = body && typeof body === 'object' ? Object.entries(body as Record<string, unknown>) : [];

	const rank = (id: string) => {
		const position = FIRST_PARTY_PROVIDERS.indexOf(id);

		return position < 0 ? FIRST_PARTY_PROVIDERS.length : position;
	};

	const prices = new Map<string, ModelCost>();

	for (const [, provider] of providers.sort(([a], [b]) => rank(a) - rank(b))) {
		const models = (provider as { models?: Record<string, { id?: unknown; cost?: unknown }> } | null)?.models;

		for (const [key, model] of Object.entries(models ?? {})) {
			const id = normalizeModelId(typeof model?.id === 'string' ? model.id : key);
			const cost = modelsDevCost(model?.cost);

			if (cost && !prices.has(id)) prices.set(id, cost);
		}
	}

	return (model) => prices.get(normalizeModelId(model)) ?? null;
}

/**
 * The prices from models.dev, cached for an hour with the hosted catalogs. When models.dev cannot be reached every
 * model is unpriced, so a report shows its token counts with no cost instead of failing.
 */
export async function loadPriceLookup(): Promise<PriceLookup> {
	try {
		return priceLookupFrom(await modelsDevCatalog());
	} catch (error) {
		console.warn('[usage] could not load model prices', error instanceof Error ? error.message : error);

		return () => null;
	}
}
