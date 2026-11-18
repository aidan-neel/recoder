import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { Components, ExtraProps } from 'react-markdown';

import { CodeBlock } from './code-block';
import { codeSource } from './code-block-view';
import { StaticCodeBlock } from './static-code-block';

type HastElement = NonNullable<ExtraProps['node']>;

type HastChild = HastElement['children'][number];

/** A fenced code block as the Markdown source wrote it. */
export interface MarkdownFence {
	/** The code, without its final newline. */
	code: string;
	/** The fence's language name, or null when it names none. */
	lang: string | null;
	/** What follows the language on the fence's opening line, such as `title="config.json"`; empty when nothing does. */
	meta: string;
}

/** The text inside a hast node, tags dropped. */
function textOf(node: HastChild): string {
	if (node.type === 'text') return node.value;

	return node.type === 'element' ? node.children.map(textOf).join('') : '';
}

/** The fence language from a code element's `language-*` class, if it has one. */
function fenceLang(code: HastElement): string | null {
	const classes = code.properties.className;
	const names = Array.isArray(classes) ? classes.map(String) : [];

	return names.find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? null;
}

/** The fence a `pre` holds, its code as the parser gives it (with a final newline), or null for a `pre` with no code element. */
function readFence(node: HastElement | undefined): MarkdownFence | null {
	const code = node?.children.find(
		(child): child is HastElement => child.type === 'element' && child.tagName === 'code'
	);

	if (!code) return null;

	const meta = code.data && 'meta' in code.data ? code.data.meta : null;

	return { code: textOf(code), lang: fenceLang(code), meta: typeof meta === 'string' ? meta : '' };
}

/** Fenced code: the kit's code block, highlighted in the fence's language once the highlighter loads, with a copy button. */
function Fence({ node }: ComponentProps<'pre'> & ExtraProps) {
	const fence = readFence(node);

	return fence ? <CodeBlock code={fence.code} lang={fence.lang} copy /> : null;
}

/** Fenced code rendered on the server, its colors already in the HTML. */
function StaticFence({ node }: ComponentProps<'pre'> & ExtraProps) {
	const fence = readFence(node);

	return fence ? <StaticCodeBlock source={codeSource(fence.code)} lang={fence.lang} copy /> : null;
}

/** Inline code. Fenced code never reaches here: `Fence` renders it whole. */
function InlineCode({ children }: ComponentProps<'code'>) {
	return <code className="inline-code">{children}</code>;
}

/**
 * A link. Web links open in a new tab. react-markdown empties an unsafe URL
 * (`javascript:` and the like), and an empty one renders as plain text.
 */
function Link({ href, title, children }: ComponentProps<'a'>) {
	if (!href) return <span data-unsafe-url="">{children}</span>;

	const external = /^https?:\/\//i.test(href);

	return (
		<a
			href={href}
			title={title}
			target={external ? '_blank' : undefined}
			rel={external ? 'noopener noreferrer' : undefined}
		>
			{children}
		</a>
	);
}

/** Images become links to the image, so a reply cannot load remote pixels on its own. */
function Image({ src, alt }: ComponentProps<'img'>) {
	return <Link href={typeof src === 'string' ? src : undefined}>{alt || 'Image'}</Link>;
}

/** A table, scrolling sideways inside its own box when it is wider than the text. */
function Table({ children }: ComponentProps<'table'>) {
	return (
		<div data-ui="markdown-table">
			<table>{children}</table>
		</div>
	);
}

/** How Markdown renders the elements that need more than default HTML. */
export const MARKDOWN_PARTS: Components = { pre: Fence, code: InlineCode, a: Link, img: Image, table: Table };

/** The same parts for `StaticMarkdown`, whose fenced code is highlighted on the server. */
export const STATIC_MARKDOWN_PARTS: Components = { ...MARKDOWN_PARTS, pre: StaticFence };

/**
 * A page's own drawing of the code in its Markdown, such as a docs page that
 * gives a fence a head row. Keep one object for the life of the page:
 * rendered text is cached by it.
 */
export interface MarkdownCodeParts {
	/** Draws a fenced block in place of the kit's code block. It may be an async server component. */
	fence?: ComponentType<MarkdownFence>;
	/** Draws inline code in place of the kit's `code` element. */
	inline?: ComponentType<{ code: string }>;
}

const STATIC_CODE_PARTS = new WeakMap<MarkdownCodeParts, Components>();

/** The static parts with `code`'s fences and inline code drawn by its components. One table per `code`, kept. */
export function staticPartsWithCode(code: MarkdownCodeParts): Components {
	const kept = STATIC_CODE_PARTS.get(code);

	if (kept) return kept;

	const { fence: CustomFence, inline: CustomInline } = code;
	const parts: Components = { ...STATIC_MARKDOWN_PARTS };

	if (CustomFence) {
		parts.pre = ({ node }: ComponentProps<'pre'> & ExtraProps) => {
			const fence = readFence(node);

			return fence ? <CustomFence {...fence} code={codeSource(fence.code)} /> : null;
		};
	}

	if (CustomInline) {
		parts.code = ({ children }: ComponentProps<'code'>) =>
			typeof children === 'string' ? <CustomInline code={children} /> : <InlineCode>{children}</InlineCode>;
	}

	STATIC_CODE_PARTS.set(code, parts);

	return parts;
}

/** Links whose target starts with `prefix` draw through `component` instead of as plain links, such as a citation chip. */
export interface LinkOverride {
	prefix: string;
	component: ComponentType<{ href: string; children: ReactNode }>;
}

const OVERRIDE_PARTS = new WeakMap<LinkOverride['component'], Map<string, Components>>();

/**
 * The parts with `override`'s links drawn by its component. One table per override, kept, because rendered
 * text is cached by its table's identity.
 */
export function partsWithLinkOverride({ prefix, component: Custom }: LinkOverride): Components {
	const byPrefix = OVERRIDE_PARTS.get(Custom) ?? new Map<string, Components>();
	const kept = byPrefix.get(prefix);

	if (kept) return kept;

	const parts: Components = {
		...MARKDOWN_PARTS,
		a: (props: ComponentProps<'a'>) =>
			props.href?.startsWith(prefix) ? <Custom href={props.href}>{props.children}</Custom> : <Link {...props} />
	};

	byPrefix.set(prefix, parts);
	OVERRIDE_PARTS.set(Custom, byPrefix);

	return parts;
}
