'use client';

import { ScrollArea } from '@recoder/ui';
import { useLayoutEffect, useRef, type RefObject, type UIEvent } from 'react';

interface StreamViewProps {
	/** The draft so far. */
	text: string;
	/** The text field's height when the draft began, so the editor keeps its size as the two swap. */
	minHeight: number | undefined;
}

/** How near the end, in px, the reader must be for the view to keep following the draft. */
const FOLLOW_WITHIN = 32;

/**
 * Keeps the end of a growing text in view until the reader scrolls up, and
 * follows again once they come back to the end.
 */
function useFollowEnd(text: string): {
	viewport: RefObject<HTMLDivElement | null>;
	onScroll: (event: UIEvent<HTMLDivElement>) => void;
} {
	const viewport = useRef<HTMLDivElement>(null);
	const following = useRef(true);

	useLayoutEffect(() => {
		const node = viewport.current;

		if (node && following.current) node.scrollTop = node.scrollHeight;
	}, [text]);

	function onScroll(event: UIEvent<HTMLDivElement>): void {
		const node = event.currentTarget;

		following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_WITHIN;
	}

	return { viewport, onScroll };
}

/**
 * The editor while a draft streams in: the same box and type as the text
 * field, read-only, with a caret where the next words land. It starts at the
 * field's height, so nothing under it moves, and follows the end of the text
 * unless the reader scrolls up.
 */
export function StreamView({ text, minHeight }: StreamViewProps) {
	const { viewport, onScroll } = useFollowEnd(text);

	return (
		<ScrollArea className="guidelines-stream" viewportRef={viewport} viewportProps={{ tabIndex: 0, onScroll }}>
			<div
				role="status"
				aria-label="Draft in progress"
				aria-busy
				className="guidelines-field guidelines-stream-text"
				data-empty={text ? undefined : ''}
				style={{ minHeight }}
			>
				{text ? null : <span data-ui="markdown-caret" aria-hidden className="guidelines-caret-lead" />}
				{text || 'Drafting…'}
				{text ? <span data-ui="markdown-caret" aria-hidden /> : null}
			</div>
		</ScrollArea>
	);
}
