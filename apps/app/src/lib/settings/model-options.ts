import {
	appName,
	defaultEffort,
	looksLikeModelId,
	parseVllmModelId,
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
	/** The server stopped serving it: it is listed so a pick shows as missing, but cannot be chosen. */
	unavailable: boolean;
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

/** The model picks: `orchestrator` runs the reviewers, `specialist` the subagents, `verifier` the checks of each finding. */
export type ModelRole = 'orchestrator' | 'specialist' | 'verifier';

/** The picks in the order Settings lists them. */
export const MODEL_ROLES: readonly ModelRole[] = ['orchestrator', 'specialist', 'verifier'];

/**
 * Each pick's one name, for its row, its dialog and its labels. Orchestrator,
 * the agent in chat, runs on the Review model.
 */
export const ROLE_NAME: Record<ModelRole, string> = {
	orchestrator: 'Review model',
	specialist: 'Subagent model',
	verifier: 'Verifier model'
};

/** True for a pick that runs on the Review model while it is unset: every pick but the Review model itself. */
export function followsWhenUnset(role: ModelRole): boolean {
	return role !== 'orchestrator';
}

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
	const group = multiAgent && entry.agent && entry.agent !== provider ? `${entry.agent} · ${provider}` : provider;
	const name = displayName(entry);

	return {
		id: entry.id,
		name,
		group,
		efforts,
		defaultEffort: defaultEffort(entry),
		contextWindow: entry.contextWindow ?? null,
		unavailable: entry.unavailable ?? false,
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

/** What a role is set to now. `follows`: the pick is unset and runs on the Review model. */
export interface RolePick {
	/** The saved model id; null when nothing is picked. */
	id: string | null;
	/** The registry entry, when the id is still offered. */
	option: ModelOption | undefined;
	effort: ReasoningEffort | null;
	follows: boolean;
}

/** A role's saved model id and effort, before the catalog is looked up. */
interface SavedPick {
	id: string | null;
	effort: ReasoningEffort | null | undefined;
}

/** Where each role's pick is saved. An unset Review pick falls back to the older shared pick. */
const SAVED_PICK: Record<ModelRole, (settings: ModelSettings) => SavedPick> = {
	orchestrator: (settings) => ({
		id: settings.orchestratorModelId ?? settings.sharedModelId ?? null,
		effort: settings.orchestratorEffort
	}),
	specialist: (settings) => ({ id: settings.specialistModelId ?? null, effort: settings.specialistEffort }),
	verifier: (settings) => ({ id: settings.verifierModelId ?? null, effort: settings.verifierEffort })
};

/** The saved pick for a role. */
export function rolePick(settings: ModelSettings, role: ModelRole): RolePick {
	const { id, effort } = SAVED_PICK[role](settings);
	const option = id ? modelCatalog(settings.models).byId.get(id) : undefined;

	return { id, option, effort: resolveEffort(option, effort), follows: followsWhenUnset(role) && !id };
}

/**
 * Why a pick can't run, in plain words, or null when it can: its vLLM server
 * stopped serving the model, or was disconnected. Other picks are never missing here.
 */
export function missingNote(pick: RolePick): string | null {
	if (pick.option?.unavailable) return `${pick.option.name} is no longer served. Pick another model or reviews stop.`;

	const parsed = pick.id && !pick.option ? parseVllmModelId(pick.id) : null;

	return parsed ? 'Its vLLM server is disconnected. Pick another model or connect it again.' : null;
}

/** True when every word of the query appears somewhere in the model's name, group or id, in any order. */
export function matchesQuery(option: ModelOption, terms: readonly string[]): boolean {
	return terms.every((term) => option.haystack.includes(term));
}
