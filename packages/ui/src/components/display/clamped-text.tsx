'use client';

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button';

interface ClampedTextProps {
	/** How many lines show while it is shut. */
	lines: number;
	children: ReactNode;
	className?: string;
}

interface Heights {
	/** The shut height: `lines` lines of the text's own line height. */
	shut: number;
	/** The height of all of it. */
	full: number;
	/** One line of the text, in px. */
	line: number;
}

/** The line height the text inside sets, in px; 1.5 times its font size when it says `normal`. */
function lineHeightOf(element: Element): number {
	const style = getComputedStyle(element);
	const height = Number.parseFloat(style.lineHeight);

	return Number.isNaN(height) ? Number.parseFloat(style.fontSize) * 1.5 : height;
}

/**
 * Measures the text before the first paint and again whenever it reflows
 * (a wider window, streamed text), so the cut and the open height stay true.
 */
function useHeights(lines: number) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [heights, setHeights] = useState<Heights | null>(null);

	useLayoutEffect(() => {
		const body = bodyRef.current;

		if (!body) return;

		const measure = () => {
			const line = lineHeightOf(body.firstElementChild ?? body);

			setHeights({ shut: Math.round(lines * line), full: body.scrollHeight, line });
		};

		const observer = new ResizeObserver(measure);

		measure();
		observer.observe(body);

		return () => observer.disconnect();
	}, [lines]);

	return { bodyRef, heights };
}

/**
 * How many lines past the cut a text may run and still show whole: hiding a
 * single line saves less room than the Show more under it takes. The extra
 * quarter absorbs inline code chips that make a line a pixel taller.
 */
const SLACK_LINES = 1.25;

/** True when shutting the text hides more than a line. */
function isLong(heights: Heights | null): heights is Heights {
	return heights !== null && heights.full > heights.shut + heights.line * SLACK_LINES;
}

/** The clip's height: the cut while shut, the whole text while open, none for a text that fits. */
function clipHeight(heights: Heights | null, state: 'open' | 'closed'): number | undefined {
	if (!isLong(heights)) return undefined;

	return state === 'open' ? heights.full : heights.shut;
}

/**
 * Long text shut to its first lines, so a reader opens the rest on purpose.
 * The last shown line fades out; Show more under it grows the box to the
 * whole text over `--dur-disclose`, and Show less shuts it again. Text that
 * fits shows whole, with no control. Every word stays in the page, so a
 * screen reader and find-in-page reach all of it.
 */
export function ClampedText({ lines, children, className }: ClampedTextProps) {
	const clipId = useId();
	const [open, setOpen] = useState(false);
	const { bodyRef, heights } = useHeights(lines);
	const state = open ? 'open' : 'closed';
	const overflows = isLong(heights);

	return (
		<div data-ui="clamped-text" data-state={state} data-overflows={overflows || undefined} className={cn(className)}>
			<div id={clipId} data-ui="clamped-text-clip" style={{ maxHeight: clipHeight(heights, state) }}>
				<div ref={bodyRef}>{children}</div>
			</div>
			{overflows ? (
				<div data-ui="clamped-text-foot">
					<Button variant="ghost" size="sm" aria-expanded={open} aria-controls={clipId} onClick={() => setOpen(!open)}>
						{open ? 'Show less' : 'Show more'}
					</Button>
				</div>
			) : null}
		</div>
	);
}
