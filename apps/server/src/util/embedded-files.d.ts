/**
 * Files imported with `with { type: 'file' }`: the import is the file's path, inside the
 * binary once `bun build --compile` embeds it.
 */
declare module '*.wasm' {
	const path: string;

	export default path;
}

/** Markdown imported with `with { type: 'text' }`: the import is the file's text. */
declare module '*.md' {
	const text: string;

	export default text;
}
