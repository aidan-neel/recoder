'use client';

import { MarkdownProse, warmMarkdown, type MarkdownProps } from './markdown-render';

if (typeof window !== 'undefined') warmMarkdown();

/**
 * Model and docs prose in a client component, where text can still be
 * arriving (a chat reply). It renders through the same `MarkdownProse` as
 * `StaticMarkdown`, so the two look alike.
 */
export function Markdown(props: MarkdownProps) {
	return <MarkdownProse {...props} />;
}
