import type { ReasoningEffort } from '@recoder/shared';
import { savedReviewModelId } from '../../models/models.js';
import { getStoredSettings } from '../../review/session/review-settings.js';
import { usageError } from '../exit.js';
import { listAcceptedModels, type AcceptedModel, type ModelLookup } from '../run/model-choices.js';
import { providerNameOf } from './provider-name.js';

/** Which of the accepted models to list: those of these providers (null for all) and those that match the text. */
export interface ModelsQuery {
	providers: string[] | null;
	search: string | null;
}

/** One model `--reviewer` and `--worker` accept, as `recoder models` prints it. */
interface ListedModel {
	id: string;
	name: string;
	/** What the app's model picker groups the model under. */
	provider: string;
	/** The reasoning efforts the model offers; empty when it has none. */
	efforts: ReasoningEffort[];
	defaultEffort: ReasoningEffort | null;
}

/** What `recoder models` prints. */
export interface ModelList {
	/** The saved Review model's id; null when nothing is saved. */
	reviewer: string | null;
	/** The saved id of the model the workers run on; null when they follow the Review model. */
	worker: string | null;
	models: ListedModel[];
	/** One line for each agent that could not list its models, so a missing model is not mistaken for an absent one. */
	problems: string[];
}

/**
 * The models `--reviewer` and `--worker` accept, grouped by provider, A to Z, in the order each source lists them.
 * A provider no listed model has is a usage error that names the providers there are.
 */
export async function listModels(query: ModelsQuery, lookup: ModelLookup): Promise<ModelList> {
	const { models, problems } = await listAcceptedModels(lookup);
	const listed = models.map(describeModel).sort((a, b) => a.provider.localeCompare(b.provider));

	if (query.providers !== null) rejectUnknownProviders(query.providers, listed, problems);

	return {
		reviewer: savedReviewModelId() ?? null,
		worker: getStoredSettings().specialistModelId ?? null,
		models: listed.filter((model) => matchesQuery(model, query)),
		problems
	};
}

function describeModel({ entry, choices }: AcceptedModel): ListedModel {
	return {
		id: entry.id,
		name: entry.label,
		provider: providerNameOf(entry),
		efforts: (choices.efforts ?? []).map((effort) => (typeof effort === 'string' ? effort : effort.id)),
		defaultEffort: choices.defaultEffort
	};
}

/** An agent that could not list its models is named, since the provider asked for may be one of its own. */
function rejectUnknownProviders(
	names: readonly string[],
	listed: readonly ListedModel[],
	problems: readonly string[]
): void {
	const known = [...new Set(listed.map((model) => model.provider))];
	const unknown = names.filter((name) => !known.some((provider) => sameText(provider, name)));

	if (unknown.length === 0) return;

	const available = known.length > 0 ? `Providers: ${known.join(', ')}.` : 'No provider lists a model here.';
	const missing = problems.length > 0 ? ` Some providers are missing: ${problems.join('; ')}.` : '';

	throw usageError(
		`--provider names no provider with models here: ${unknown.map((name) => `"${name}"`).join(', ')}. ${available}${missing}`
	);
}

function matchesQuery(model: ListedModel, query: ModelsQuery): boolean {
	const providerMatches = query.providers === null || query.providers.some((name) => sameText(model.provider, name));
	const text = `${model.id}\n${model.name}`.toLowerCase();

	return providerMatches && (query.search === null || text.includes(query.search.toLowerCase()));
}

function sameText(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}
