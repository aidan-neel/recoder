import { CodeBlockView, type CodeBlockLook } from './code-block-view';
import { highlightNow, preloadHighlighter } from './highlight';

interface StaticCodeBlockProps extends CodeBlockLook {
	/** The code, without its final newline. */
	source: string;
	/** A highlight language (a fence name or an extension); plain text when null. */
	lang: string | null;
}

/**
 * A code block highlighted on the server: an async server component that
 * loads the highlighter and the grammar first, so the colors are in the HTML
 * itself and the page ships no highlighter.
 */
export async function StaticCodeBlock({ source, lang, ...look }: StaticCodeBlockProps) {
	await preloadHighlighter([lang]);

	return <CodeBlockView source={source} html={highlightNow(source, lang)} {...look} />;
}
