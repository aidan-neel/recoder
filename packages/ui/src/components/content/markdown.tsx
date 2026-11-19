'use client';

import { useRef } from 'react';

import { MarkdownProse, warmMarkdown, type MarkdownProps } from './markdown-render';
import { useStreamFade } from './stream-fade';
import { useStreamReveal } from './use-stream-reveal';

if (typeof window !== 'undefined') warmMarkdown();

/**
 * Model and docs prose in a client component, where text can still be
 * arriving (a chat reply). It renders through the same `MarkdownProse` as
 * `StaticMarkdown`, so the two look alike. Streaming text goes out a few
 * words at a time, and each stretch fades in by colour over 160ms, as Capy's
 * replies do.
 */
export function Markdown({ children, streaming = false, ...props }: MarkdownProps) {
	const ref = useRef<HTMLDivElement>(null);
	const reveal = useStreamReveal(children, streaming);

	useStreamFade(ref, reveal.text, reveal.streaming);

	return (
		<MarkdownProse {...props} ref={ref} streaming={reveal.streaming}>
			{reveal.text}
		</MarkdownProse>
	);
}
