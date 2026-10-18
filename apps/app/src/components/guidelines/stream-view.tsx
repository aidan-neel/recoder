'use client';

import { cn, ScrollArea } from '@recoder/ui';

import { useStickToBottom } from '@/lib/ask/stick-to-bottom';

/**
 * The editor while a draft streams in: the same box and type as the text
 * field, read-only, with a blinking caret where the next words land. It
 * starts at the field's height (`minHeight`), so nothing below it jumps, and
 * follows the end of the text unless the reader scrolls up.
 */
export function StreamView({ text, minHeight }: { text: string; minHeight?: number }) {
	const { attachViewport, attachContent } = useStickToBottom('draft');

	return (
		<ScrollArea className="guidelines-stream" viewportRef={attachViewport}>
			<div
				ref={attachContent}
				role="status"
				aria-label="Draft in progress"
				aria-busy
				data-ui="guidelines-stream"
				className={cn('guidelines-field guidelines-stream-text', !text && 'text-fg-faint')}
				style={{ minHeight }}
			>
				{text ? null : <span data-ui="markdown-caret" aria-hidden className="guidelines-caret-lead" />}
				{text || 'Drafting…'}
				{text ? <span data-ui="markdown-caret" aria-hidden /> : null}
			</div>
		</ScrollArea>
	);
}
