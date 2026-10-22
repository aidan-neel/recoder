import {
	appName,
	defaultEffort,
	looksLikeModelId,
	prettyModelName,
	resolveEffort,
	type ModelEntry,
	type ModelSettings,
	type ReasoningEffort
} from '@recoder/shared';

/** A model from the registry, ready for a picker: its name, its group and the efforts it accepts. */
export interface ModelOption {
	id: string;
	name: string;
	/** The group it lists under: the provider, after the agent when several agents run models ("OpenCode · OpenRouter"). */
	group: string;
	/** Null when the model has no reasoning control. */
	efforts: ReasoningEffort[] | null;
	defaultEffort: ReasoningEffort | null;
	/** Tokens per request, when the agent reported it. */
	contextWindow: number | null;
	/** Lowercased name, group and id, for the search. */
	haystack: string;
}

/** The models of one provider, in the order the agent listed them. */
export interface ModelGroup {
	heading: string;
	options: ModelOption[];
}

/** The models settings offer, grouped, with a lookup by id. */
export interface ModelCatalog {
	groups: ModelGroup[];
	byId: Map<string, ModelOption>;
	count: number;
}

/** The two model picks: `orchestrator` runs the reviewers; `specialist` runs subagents and verifiers. */
export type ModelRole = 'orchestrator' | 'specialist';

/**
 * Each pick's one name, for its row, its dialog and its labels. Orchestrator,
 * the agent in chat, runs on the Review model.
 */
export const ROLE_NAME: Record<ModelRole, string> = { orchestrator: 'Review model', specialist: 'Subagent model' };

/** The entry's name; one still named by its raw id reads as a name. */
function displayName(entry: ModelEntry): string {
	return looksLikeModelId(entry.label) ? prettyModelName(entry.label) : entry.label;
}

/** Who serves the model: the app (Claude Code, Devin), else the provider the agent reaches it through. */
function providerName(entry: ModelEntry): string {
	return appName(entry.provider) || entry.source || entry.agent || 'Custom';
}

function toModelOption(entry: ModelEntry, multiAgent: boolean): ModelOption {
	const efforts = entry.efforts?.length ? entry.efforts : null;
	const provider = providerName(entry);
	const agent = entry.agent ?? 'Custom';
	const group = multiAgent && agent !== provider ? `${agent} · ${provider}` : provider;
	const name = displayName(entry);

	return {
		id: entry.id,
		name,
		group,
		efforts,
		defaultEffort: defaultEffort(entry),
		contextWindow: entry.contextWindow ?? null,
		haystack: `${name} ${group} ${entry.id}`.toLowerCase()
	};
}

const catalogs = new WeakMap<ModelEntry[], ModelCatalog>();

/** The registry grouped by provider, groups A to Z. Built once per model list. */
export function modelCatalog(entries: ModelEntry[]): ModelCatalog {
	const cached = catalogs.get(entries);

	if (cached) return cached;

	const multiAgent = new Set(entries.map((entry) => entry.agent)).size > 1;
	const byHeading = new Map<string, ModelOption[]>();
	const byId = new Map<string, ModelOption>();

	for (const entry of entries) {
		const option = toModelOption(entry, multiAgent);
		const group = byHeading.get(option.group);

		if (group) group.push(option);
		else byHeading.set(option.group, [option]);

		byId.set(option.id, option);
	}

	const groups = [...byHeading.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([heading, options]) => ({ heading, options }));

	const catalog = { groups, byId, count: entries.length };

	catalogs.set(entries, catalog);

	return catalog;
}

/** What a role is set to now. `follows`: the subagent pick is unset and runs on the Review model. */
export interface RolePick {
	/** The saved model id; null when nothing is picked. */
	id: string | null;
	/** The registry entry, when the id is still offered. */
	option: ModelOption | undefined;
	effort: ReasoningEffort | null;
	follows: boolean;
}

/** The saved pick for a role. An unset Review pick falls back to the older shared pick. */
export function rolePick(settings: ModelSettings, role: ModelRole): RolePick {
	const { byId } = modelCatalog(settings.models);

	const id =
		role === 'orchestrator'
			? (settings.orchestratorModelId ?? settings.sharedModelId ?? null)
			: (settings.specialistModelId ?? null);

	const option = id ? byId.get(id) : undefined;
	const saved = role === 'orchestrator' ? settings.orchestratorEffort : settings.specialistEffort;

	return { id, option, effort: resolveEffort(option, saved), follows: role === 'specialist' && !id };
}

/** True when every word of the query appears somewhere in the model's name, group or id, in any order. */
export function matchesQuery(option: ModelOption, terms: readonly string[]): boolean {
	return terms.every((term) => option.haystack.includes(term));
}

/** A search box's text as lowercase words. */
export function queryTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}
