import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';
import { grammarFor, languageFor } from './languages.js';

/** Where `tree-sitter-wasms` keeps its prebuilt grammars, wherever the package was installed. */
const WASM_DIR = join(dirname(fileURLToPath(import.meta.resolve('tree-sitter-wasms/package.json'))), 'out');

/** Shared by every caller, so concurrent first parses initialize the runtime once. */
let ready: Promise<void> | null = null;

/** One parser per grammar, created on first use; parsing is synchronous, so sharing one is safe. */
const parsers = new Map<string, Promise<Parser>>();

function init(): Promise<void> {
	ready ??= Parser.init();

	return ready;
}

function parserFor(grammar: string): Promise<Parser> {
	let parser = parsers.get(grammar);

	if (!parser) {
		parser = init().then(async () => {
			const language = await Language.load(join(WASM_DIR, `tree-sitter-${grammar}.wasm`));
			const created = new Parser();

			created.setLanguage(language);

			return created;
		});

		parsers.set(grammar, parser);
	}

	return parser;
}

/**
 * A Svelte file with everything outside its `<script>` blocks blanked to spaces.
 * Newlines are kept, so rows and columns in the tree match the original file.
 */
function svelteScripts(source: string): string {
	const out = source.replace(/[^\n]/g, ' ').split('');
	const pattern = /<script\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/g;

	for (const match of source.matchAll(pattern)) {
		const start = (match.index ?? 0) + match[0].length - match[1].length - '</script>'.length;
		const body = match[1];

		for (let i = 0; i < body.length; i++) out[start + i] = body[i];
	}

	return out.join('');
}

/**
 * Parses `source` as the language its path implies and hands the root to `use`,
 * freeing the tree afterwards so the WASM heap doesn't grow across many files.
 * Null when no grammar covers the path or the parser gives up.
 */
export async function withTree<T>(
	path: string,
	source: string,
	use: (root: Node, language: string) => T
): Promise<T | null> {
	const language = languageFor(path);

	if (!language) return null;

	const parser = await parserFor(grammarFor(language));
	const tree = parser.parse(language === 'svelte' ? svelteScripts(source) : source);

	if (!tree) return null;

	try {
		return use(tree.rootNode, language);
	} finally {
		tree.delete();
	}
}
