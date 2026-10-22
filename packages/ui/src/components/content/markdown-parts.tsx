import type { ComponentProps } from 'react';
import type { Components, ExtraProps } from 'react-markdown';

import { CodeBlock } from './code-block';

type HastElement = NonNullable<ExtraProps['node']>;

type HastChild = HastElement['children'][number];

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

/** Fenced code: the kit's code block, highlighted in the fence's language, with a copy button. */
function Fence({ node }: ComponentProps<'pre'> & ExtraProps) {
	const code = node?.children.find(
		(child): child is HastElement => child.type === 'element' && child.tagName === 'code'
	);

	if (!code) return null;

	return <CodeBlock code={textOf(code)} lang={fenceLang(code)} copy />;
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
		<div data-ui="markdown-table" className="thin-scroll">
			<table>{children}</table>
		</div>
	);
}

/** How Markdown renders the elements that need more than default HTML. */
export const MARKDOWN_PARTS: Components = { pre: Fence, code: InlineCode, a: Link, img: Image, table: Table };
