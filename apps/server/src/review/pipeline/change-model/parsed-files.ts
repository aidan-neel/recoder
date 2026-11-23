import { readFact, writeFact } from '../../../util/fact-cache.js';
import { readObjects } from '../repo-inventory/blobs.js';
import type { RepoFile, RepoInventory } from '../repo-inventory/repo-inventory.js';
import { mapLimit } from '../../../util/map-limit.js';
import { parserVersion } from './parser-version.js' with { type: 'macro' };
import { MAX_FILE_BYTES } from './repo.js';
import { symbolsOf, type ParsedSymbol } from './symbols.js';

const NAMESPACE = 'parsed-symbols';

/** Changes with how code parses, so a parser change starts new keys and old declarations are never read back. */
const PARSER_VERSION = parserVersion();

/**
 * Each path's declarations at the inventory's commit, keyed by path. A path
 * that is not tracked, has no grammar, is too large or is not text maps to an
 * empty list. Declarations are stored per blob and path, so a file unchanged
 * since any earlier review in the repository, on any pull request, is neither
 * read nor parsed again.
 */
export async function parseRepoFiles(
	root: string,
	repo: RepoInventory,
	paths: string[],
	signal: AbortSignal
): Promise<Map<string, ParsedSymbol[]>> {
	const parsed = new Map<string, ParsedSymbol[]>();
	const missing: RepoFile[] = [];

	for (const path of paths) {
		const file = repo.byPath.get(path);

		if (!file || file.size > MAX_FILE_BYTES) {
			parsed.set(path, []);
			continue;
		}

		const cached = readFact<ParsedSymbol[]>(NAMESPACE, factKey(file));

		if (cached) parsed.set(path, cached);
		else missing.push(file);
	}

	const texts = await readObjects(
		root,
		missing.map((file) => file.blob),
		signal
	);

	await mapLimit(missing, 8, async (file) => {
		const source = texts.get(file.blob);
		const symbols = source === undefined ? [] : ((await symbolsOf(file.path, source)) ?? []);

		parsed.set(file.path, symbols);
		if (source !== undefined) writeFact(NAMESPACE, factKey(file), symbols);
	});

	return parsed;
}

/** The path is part of the key: it decides the grammar and every symbol's `file`. */
function factKey(file: RepoFile): string {
	return `${PARSER_VERSION}\0${file.blob}\0${file.path}`;
}
