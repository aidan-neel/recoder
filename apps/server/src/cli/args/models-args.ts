import { usageError } from '../exit.js';
import type { ModelsQuery } from '../models/model-list.js';
import { MODELS_FLAGS } from './flags.js';
import { splitList } from './lists.js';
import { parseFlags } from './parse.js';
import { parseText } from './values.js';

/**
 * Reads the flags of `recoder models`, which the MCP models tool passes too. Which providers exist is only known once
 * the models are listed, so a provider name is checked there.
 */
export function parseModelsQuery(argv: string[]): ModelsQuery {
	const values = parseFlags(argv, { options: MODELS_FLAGS, strict: true, allowPositionals: false });

	return { providers: parseProviders(values.provider), search: parseText('--search', values.search) };
}

function parseProviders(values: string[] | undefined): string[] | null {
	if (values === undefined) return null;

	const names = splitList(values);

	if (names.length === 0) throw usageError('--provider needs at least one provider name.');

	return names;
}
