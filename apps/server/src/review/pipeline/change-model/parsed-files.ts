import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFact, writeFact } from '../../../util/fact-cache.js';
import { readObjects } from '../repo-inventory/blobs.js';
import type { RepoFile, RepoInventory } from '../repo-inventory/repo-inventory.js';
import { mapLimit, MAX_FILE_BYTES } from './repo.js';
import { symbolsOf, type ParsedSymbol } from './symbols.js';

const NAMESPACE = 'parsed-symbols';

/** Everything that decides what a file parses to: the walker, the grammar specs, the parser and the grammar builds. */
const PARSER_FILES = [
	new URL('./symbols.ts', import.meta.url).href,
	new URL('./grammar-spec.ts', import.meta.url).href,
	new URL('./parser.ts', import.meta.url).href,
	new URL('./languages.ts', import.meta.url).href,
	import.meta.resolve('tree-sitter-wasms/package.json'),
	import.meta.resolve('web-tree-sitter/package.json')
];

/** A hash of the parser's files, so a change to how code parses starts new keys and old declarations are never read back. */
const PARSER_VERSION = (() => {
	const hash = createHash('sha256');

	for (const url of PARSER_FILES) hash.update(readFileSync(fileURLToPath(url)));

	return hash.digest('hex').slice(0, 16);
})();

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
