import { Language, Parser, type Node } from 'web-tree-sitter';
import runtimeWasm from 'web-tree-sitter/tree-sitter.wasm' with { type: 'file' };
import goWasm from 'tree-sitter-wasms/out/tree-sitter-go.wasm' with { type: 'file' };
import javaWasm from 'tree-sitter-wasms/out/tree-sitter-java.wasm' with { type: 'file' };
import javascriptWasm from 'tree-sitter-wasms/out/tree-sitter-javascript.wasm' with { type: 'file' };
import pythonWasm from 'tree-sitter-wasms/out/tree-sitter-python.wasm' with { type: 'file' };
import rubyWasm from 'tree-sitter-wasms/out/tree-sitter-ruby.wasm' with { type: 'file' };
import rustWasm from 'tree-sitter-wasms/out/tree-sitter-rust.wasm' with { type: 'file' };
import tsxWasm from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm' with { type: 'file' };
import typescriptWasm from 'tree-sitter-wasms/out/tree-sitter-typescript.wasm' with { type: 'file' };
import { grammarFor, languageFor } from './languages.js';

/**
 * Each grammar's `.wasm`, imported as a file so `bun build --compile` embeds it in the
 * `recoder` binary. From source the path is the file in `node_modules`.
 */
const GRAMMAR_FILES: Record<string, string> = {
	go: goWasm,
	java: javaWasm,
	javascript: javascriptWasm,
	python: pythonWasm,
	ruby: rubyWasm,
	rust: rustWasm,
	tsx: tsxWasm,
	typescript: typescriptWasm
};

/** Shared by every caller, so concurrent first parses initialize the runtime once. */
let ready: Promise<void> | null = null;

/** One parser per grammar, created on first use; parsing is synchronous, so sharing one is safe. */
const parsers = new Map<string, Promise<Parser>>();

function init(): Promise<void> {
	ready ??= Parser.init({ locateFile: () => runtimeWasm });

	return ready;
}

function parserFor(grammar: string): Promise<Parser> {
	let parser = parsers.get(grammar);

	if (!parser) {
		parser = init().then(async () => {
			const language = await Language.load(grammarFile(grammar));
			const created = new Parser();

			created.setLanguage(language);

			return created;
		});

		parsers.set(grammar, parser);
	}

	return parser;
}

/** The `.wasm` of a grammar `languages.ts` names. */
function grammarFile(grammar: string): string {
	const file = GRAMMAR_FILES[grammar];

	if (!file) throw new Error(`no tree-sitter grammar is bundled for "${grammar}"`);

	return file;
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
