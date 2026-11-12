'use client';

import { useMemo } from 'react';

import { escapeHtml } from './highlight';
import { CodeBlockView, codeSource } from './code-block-view';
import { useHighlighter } from './use-highlighter';

interface CodeBlockProps {
	code: string;
	/** A highlight language (a fence name, an extension or `langForPath(path)`); plain text when null. */
	lang?: string | null;
	/** Adds a copy button at the top right, shown while the block is hovered or focused and while it confirms a copy. */
	copy?: boolean;
	/** Wraps long lines instead of scrolling them sideways. */
	wrap?: boolean;
	className?: string;
}

/**
 * A highlighted block of code on the code surface, the one fenced code in
 * Markdown uses. The highlighter and the grammar load on the first block in
 * a known language: until then the code shows plain, on the same lines, and
 * the colors swap in with no motion. Once loaded, blocks paint colored at once.
 */
export function CodeBlock({ code, lang = null, copy = false, wrap = false, className }: CodeBlockProps) {
	const source = codeSource(code);
	const highlighter = useHighlighter(lang);

	const html = useMemo(
		() => (highlighter ? highlighter.highlightCode(source, lang) : escapeHtml(source)),
		[highlighter, source, lang]
	);

	return <CodeBlockView source={source} html={html} copy={copy} wrap={wrap} className={className} />;
}
