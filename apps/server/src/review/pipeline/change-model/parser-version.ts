import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Everything that decides what a file parses to: the walker, the grammar specs, the parser and the grammar builds. */
const PARSER_FILES = [
	new URL('./symbols.ts', import.meta.url).href,
	new URL('./grammar-spec.ts', import.meta.url).href,
	new URL('./parser.ts', import.meta.url).href,
	new URL('./languages.ts', import.meta.url).href,
	import.meta.resolve('tree-sitter-wasms/package.json'),
	import.meta.resolve('web-tree-sitter/package.json')
];

/**
 * A hash of the parser's files. Imported as a macro, so it runs when the code is
 * transpiled or bundled and `bun build --compile` carries the hash, not the files.
 */
export function parserVersion(): string {
	const hash = createHash('sha256');

	for (const url of PARSER_FILES) hash.update(readFileSync(fileURLToPath(url)));

	return hash.digest('hex').slice(0, 16);
}
