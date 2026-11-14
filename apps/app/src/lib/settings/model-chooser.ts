import type { ModelEntry } from '@recoder/shared';

import { matchesQuery, modelCatalog, type ModelOption } from './model-options';

/** One provider's models in the chooser, after the search. */
export interface ChooserGroup {
	heading: string;
	/** The agent CLI's id that serves the group, whose mark leads the heading; empty for a plain endpoint. */
	agent: string;
	options: ModelOption[];
}

/** The agent CLI that serves the entry; empty for an endpoint Recoder calls directly. */
function agentOf(entry: ModelEntry): string {
	return entry.provider && entry.provider !== 'openai-compatible' ? entry.provider : '';
}

/**
 * Every model grouped by provider, A to Z, keeping the ones that match all of
 * the search's words. A provider with no match drops out, heading and all.
 */
export function chooserGroups(entries: ModelEntry[], terms: readonly string[]): ChooserGroup[] {
	const agents = new Map(entries.map((entry) => [entry.id, agentOf(entry)]));
	const groups: ChooserGroup[] = [];

	for (const { heading, options } of modelCatalog(entries).groups) {
		const matches = options.filter((option) => matchesQuery(option, terms));

		if (matches.length > 0) groups.push({ heading, agent: agents.get(matches[0].id) ?? '', options: matches });
	}

	return groups;
}

/** How many of the options the pickers still offer. */
export function shownCount(options: readonly ModelOption[], hidden: ReadonlySet<string>): number {
	return options.filter((option) => !hidden.has(option.id)).length;
}

/** The hidden list with `ids` shown or hidden, sorted and without repeats. */
export function withShown(hidden: readonly string[], ids: readonly string[], shown: boolean): string[] {
	const next = new Set(hidden);

	for (const id of ids) {
		if (shown) next.delete(id);
		else next.add(id);
	}

	return [...next].sort();
}
