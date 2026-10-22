'use client';

import { MarkdownProse, type MarkdownProps } from './markdown-render';

/**
 * Model and docs prose in a client component, where text can still be
 * arriving (a chat reply). It renders through the same `MarkdownProse` as
 * `StaticMarkdown`, so the two look alike.
 */
export function Markdown(props: MarkdownProps) {
	return <MarkdownProse {...props} />;
}
