import { DEFAULT_CONTEXT_WINDOW, formatContextWindow, prettyModelName, type ModelSettings } from '@recoder/shared';

import { MODEL_ROLES, modelCatalog, savedPick } from './model-options';

/** One picked model's context window: what the provider reports, what the admin set, and what reviews run with. */
export interface ContextWindowPick {
	id: string;
	name: string;
	/** The window the provider, agent or catalog reports; null when none does. */
	reported: number | null;
	/** The window saved in Settings; null when unset. */
	set: number | null;
	/** What reviews run with: the set window, else the reported one, else the default. */
	effective: number;
}

/**
 * The models the picks run on, each once, in pick order. An unset Subagent or
 * Verifier pick runs on the Review model, so it adds no model of its own.
 */
export function pickedModelIds(settings: ModelSettings): string[] {
	const ids = MODEL_ROLES.map((role) => savedPick(settings, role).id).filter((id): id is string => id !== null);

	return [...new Set(ids)];
}

/** Model `id`'s window as Settings shows it. */
export function contextWindowPick(settings: ModelSettings, id: string): ContextWindowPick {
	const option = modelCatalog(settings.models).byId.get(id);
	const reported = option?.contextWindow ?? null;
	const set = settings.contextWindows[id] ?? null;

	return {
		id,
		name: option?.name ?? prettyModelName(id),
		reported,
		set,
		effective: set ?? reported ?? DEFAULT_CONTEXT_WINDOW
	};
}

/** The line under a model's name: where its window comes from, and what the provider reports when it was set over. */
export function contextWindowDetail(pick: ContextWindowPick): string {
	if (pick.set === null)
		return pick.reported === null ? 'Default, as the provider reports none' : 'Reported by the provider';

	return pick.reported === null
		? 'The provider reports none'
		: `The provider reports ${formatContextWindow(pick.reported)}`;
}
