'use client';

import { useRef } from 'react';

import { MarkdownProse, warmMarkdown, type MarkdownProps } from './markdown-render';
import { streamWords } from './stream-words';
import { useStreamReveal, useWordFade } from './use-stream-reveal';

if (typeof window !== 'undefined') warmMarkdown();

/**
 * Model and docs prose in a client component, where text can still be
 * arriving (a chat reply). It renders through the same `MarkdownProse` as
 * `StaticMarkdown`, so the two look alike. Streaming text goes out a few
 * words at a time, each fading in from a 2px blur.
 */
export function Markdown({ children, streaming = false, ...props }: MarkdownProps) {
	const ref = useRef<HTMLDivElement>(null);
	const reveal = useStreamReveal(children, streaming);

	useWordFade(ref, reveal.streaming);

	return (
		<MarkdownProse
			{...props}
			ref={ref}
			streaming={reveal.streaming}
			plugins={reveal.streaming ? [streamWords(reveal.arrivalAt)] : undefined}
		>
			{reveal.text}
		</MarkdownProse>
	);
}
