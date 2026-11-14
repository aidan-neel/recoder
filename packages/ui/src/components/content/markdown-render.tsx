import { createElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '../../lib/cn';
import { whenIdle } from './idle';
import { cachedMarkdown } from './markdown-cache';
import { MARKDOWN_PARTS, partsWithLinkOverride, STATIC_MARKDOWN_PARTS, type LinkOverride } from './markdown-parts';
import { rehypeStreamingTail } from './rehype-tail';

type MarkdownVariant = 'ui' | 'ai';

/** What every Markdown renders from: the source, the voice and a class for the wrapper. */
interface StaticMarkdownProps {
	/** The Markdown source (GitHub flavored). Raw HTML renders as text. */
	children: string;
	/** `ui`: the UI sans for chat replies. `ai`: the Lora serif voice for summaries and findings. */
	variant?: MarkdownVariant;
	className?: string;
}

/** A client Markdown's props: text that may still be arriving. */
export interface MarkdownProps extends StaticMarkdownProps {
	/** The text is still arriving: its last few words shimmer. */
	streaming?: boolean;
	/** Draws the links with this target prefix through a component of the caller's, keeping every other link as is. */
	linkOverride?: LinkOverride;
}

const REMARK = [remarkGfm];

const WITH_TAIL = [rehypeStreamingTail];

const WITHOUT_TAIL: [] = [];

const VOICE: Record<MarkdownVariant, string> = {
	ui: 'font-sans text-[13.5px] leading-[1.6] text-fg',
	ai: 'ai-voice text-[16px] leading-[1.55]'
};

/**
 * What can make a line more than plain text: emphasis, code, links, raw HTML,
 * entities and escapes, tables, strikethrough and GFM autolinks, and a line
 * that starts a heading, quote, list or indented block, or ends in spaces.
 */
const SYNTAX = /[\\`*_[\]<>&|~@\0\t\r]|:\/\/|www\.|^[\s#>+-]|^\d+[.)]|\s$/i;

/**
 * A code span the parser keeps exactly as written: one backtick each side,
 * none next to either, and inside no backtick, line break or NUL and no
 * space at either end (the parser trims those).
 */
const CODE_SPAN = /(?<!`)`([^`\s\0](?:[^`\n\r\0]*[^`\s\0])?)`(?!`)/g;

/**
 * The paragraphs of text that holds no Markdown but such code spans, split
 * by single blank lines, or null when any of it could parse as more than
 * that. Each span counts as a letter, so a backtick left over (a run of two,
 * one with no partner) sends the whole text to the parser.
 */
function plainParagraphs(source: string): string[] | null {
	const paragraphs = source.split('\n\n');

	const plain = (text: string) => text !== '' && !text.includes('\n') && !SYNTAX.test(text.replace(CODE_SPAN, 'x'));

	return paragraphs.every(plain) ? paragraphs : null;
}

type HastElement = NonNullable<ExtraProps['node']>;

/**
 * A code span as the parser draws it: through `parts.code` when the table
 * has a component for it, which gets the hast node the parser would pass
 * (without a source position), else a `code` element.
 */
function codeSpan(parts: Components, value: string, key: string): ReactNode {
	const code = parts.code ?? 'code';

	if (typeof code === 'string') return createElement(code, { key }, value);

	const node: HastElement = { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value }] };

	return createElement(code, { key, node }, value);
}

/** A paragraph's text and code spans in order, the spans keyed as the parser keys them. */
function inlineParts(text: string, parts: Components): ReactNode[] {
	const pieces: ReactNode[] = [];
	let at = 0;
	let spans = 0;

	for (const span of text.matchAll(CODE_SPAN)) {
		if (span.index > at) pieces.push(text.slice(at, span.index));

		pieces.push(codeSpan(parts, span[1], `code-${spans++}`));
		at = span.index + span[0].length;
	}

	if (at < text.length) pieces.push(text.slice(at));

	return pieces;
}

/**
 * The tree the parser makes of plain paragraphs, built without it: a `p`
 * each, keyed as the parser keys them, a line break between them.
 */
function plainTree(paragraphs: string[], parts: Components): ReactElement {
	return (
		<>
			{paragraphs.flatMap((text, index) => [
				...(index > 0 ? ['\n'] : []),
				<p key={`p-${index}`}>{inlineParts(text, parts)}</p>
			])}
		</>
	);
}

/**
 * The React tree for a source. Complete text is parsed once and kept, so a
 * remount reuses it; streaming text is parsed on every render, its last words shimmering.
 * Complete text with no Markdown in it but code spans (a summary that names
 * a status code or a function, often) skips the parser and builds the same
 * paragraphs itself, unless `parts` draws them: the parser's first run, its
 * code not yet compiled, would otherwise land in the page's first paint.
 * `tests/content/markdown-render.test.tsx` holds the shortcut to the
 * parser's markup.
 */
function markdownTree(source: string, streaming: boolean, parts: Components): ReactElement {
	const render = () =>
		ReactMarkdown({
			children: source,
			remarkPlugins: REMARK,
			rehypePlugins: streaming ? WITH_TAIL : WITHOUT_TAIL,
			components: parts
		});

	if (streaming) return render();

	return cachedMarkdown(parts, source, () => {
		const paragraphs = parts.p ? null : plainParagraphs(source);

		return paragraphs ? plainTree(paragraphs, parts) : render();
	});
}

/** The longest a warm-up parse waits for an idle moment. */
const WARM_WAIT_MS = 1000;

/** Short samples in the shapes model text takes: a heading and inline marks, lists and a quote, a table and a fence. */
const WARM_SOURCES = [
	'## Title\n\nSome *text* with **weight**, `code` and a [link](https://example.com).',
	'- one\n- two\n\n1. first\n\n> a quote',
	'| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```'
];

/**
 * Parses each sample once while the page is idle, one per idle moment, and
 * drops the results. The parser's code compiles on its first run, so this
 * keeps that work out of the render that shows the first real Markdown.
 */
export function warmMarkdown(): void {
	for (const source of WARM_SOURCES) {
		whenIdle(
			() => ReactMarkdown({ children: source, remarkPlugins: REMARK, components: MARKDOWN_PARTS }),
			WARM_WAIT_MS
		);
	}
}

/** The longest a prepared source waits for an idle moment before it is parsed anyway. */
const PREPARE_WAIT_MS = 300;

/**
 * Parses a complete source while the page is idle and keeps its tree, so the
 * first render that shows it finds the tree made: a review's brief, read
 * before its page draws, then costs the overview's first paint nothing.
 */
export function prepareMarkdown(source: string): void {
	whenIdle(() => void markdownTree(source, false, MARKDOWN_PARTS), PREPARE_WAIT_MS);
}

/**
 * The renderer both Markdown components share. It holds no state and no
 * effects, so it runs in a server component as well as on the client.
 * Paragraphs, lists, tables, quotes and links take the kit's quiet styles;
 * fenced code renders through `parts` (the kit's code block by default).
 * Safe by default: no raw HTML, and only safe link protocols.
 */
export function MarkdownProse({
	children,
	variant = 'ui',
	streaming = false,
	className,
	linkOverride,
	parts = linkOverride ? partsWithLinkOverride(linkOverride) : MARKDOWN_PARTS
}: MarkdownProps & { parts?: Components }) {
	return (
		<div
			data-ui="markdown"
			data-variant={variant}
			data-state={streaming ? 'streaming' : 'complete'}
			aria-busy={streaming || undefined}
			className={cn('min-w-0 [overflow-wrap:break-word]', VOICE[variant], className)}
		>
			{markdownTree(children, streaming, parts)}
		</div>
	);
}

/**
 * Markdown that is complete when the page renders, such as a docs page: in a
 * server component only, since its fenced code renders through async server
 * components. It renders to HTML on the server with that code already
 * highlighted, so the page ships neither the Markdown parser nor the
 * highlighter; only a code block's copy button runs on the client.
 */
export function StaticMarkdown(props: StaticMarkdownProps) {
	return <MarkdownProse {...props} parts={STATIC_MARKDOWN_PARTS} />;
}
