/** File extension → parser language id. */
const EXTENSIONS: Record<string, string> = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	py: 'python',
	go: 'go',
	rs: 'rust',
	java: 'java',
	rb: 'ruby',
	svelte: 'svelte'
};

/** Language id → the tree-sitter grammar that parses it; a Svelte file's scripts parse as TypeScript. */
const GRAMMARS: Record<string, string> = {
	typescript: 'typescript',
	tsx: 'tsx',
	javascript: 'javascript',
	python: 'python',
	go: 'go',
	rust: 'rust',
	java: 'java',
	ruby: 'ruby',
	svelte: 'typescript'
};

/** The parser language for a path, or null when no grammar covers it. Declaration files (`.d.ts`) included. */
export function languageFor(path: string): string | null {
	const base = path.slice(path.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');

	if (dot <= 0) return null;

	return EXTENSIONS[base.slice(dot + 1).toLowerCase()] ?? null;
}

/** The grammar a language id parses with. */
export function grammarFor(language: string): string {
	return GRAMMARS[language] ?? language;
}
