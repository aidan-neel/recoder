'use client';

import { useEffect, useRef, type HTMLAttributes, type PointerEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { placeLayer, type HoverTrack } from './hover-layer';

interface HoverListProps extends HTMLAttributes<HTMLElement> {
	as?: 'div' | 'ul' | 'ol';
	/** Matches the rows that take the highlight, from the hovered element up (`[data-row]`, `li`). */
	itemSelector: string;
	className?: string;
	/** Restyles the highlight layer (radius, color, a ring). */
	highlightClassName?: string;
	children: ReactNode;
}

/**
 * Our own lists' hover highlight: one layer behind the rows that snaps to the
 * row under the pointer (no travel) and fades in over `--dur-highlight`. It
 * hides when the pointer leaves and follows its row through scrolls and
 * resizes. Touch never shows it. In a `ul` or `ol` the layer is an
 * `aria-hidden` first `li`.
 */
export function HoverList({
	as: Tag = 'div',
	itemSelector,
	className,
	highlightClassName,
	children,
	onPointerOver,
	onPointerMove,
	onPointerLeave,
	...props
}: HoverListProps) {
	const container = useRef<HTMLElement | null>(null);
	const layer = useRef<HTMLElement | null>(null);
	const track = useRef<HoverTrack>({ row: null, x: 0, y: 0 });

	/** Highlights the row holding `target`, or hides the layer when there is none. */
	function place(target: Element | null) {
		if (container.current && layer.current) {
			placeLayer(container.current, layer.current, track.current, target, itemSelector);
		}
	}

	/** Remembers where a mouse or pen rests, so a scroll can re-check the row under it. */
	function remember(event: PointerEvent<HTMLElement>): boolean {
		if (event.pointerType === 'touch') return false;

		track.current.x = event.clientX;
		track.current.y = event.clientY;

		return true;
	}

	useEffect(() => {
		const host = container.current;

		if (!host) return;

		/** Re-checks which row sits under the resting pointer after the list or a parent scrolls or resizes. */
		function reflow() {
			if (!track.current.row || !container.current || !layer.current) return;

			const target = document.elementFromPoint(track.current.x, track.current.y);

			placeLayer(container.current, layer.current, track.current, target, itemSelector);
		}

		const observer = new ResizeObserver(reflow);

		observer.observe(host);
		window.addEventListener('scroll', reflow, { capture: true, passive: true });
		window.addEventListener('resize', reflow);

		return () => {
			observer.disconnect();
			window.removeEventListener('scroll', reflow, { capture: true });
			window.removeEventListener('resize', reflow);
		};
	}, [itemSelector]);

	const Layer = Tag === 'div' ? 'span' : 'li';

	return (
		<Tag
			ref={(node: HTMLElement | null) => {
				container.current = node;
			}}
			data-ui="hover-list"
			className={cn('relative isolate', className)}
			onPointerOver={(event: PointerEvent<HTMLElement>) => {
				if (remember(event)) place(event.target as Element);

				onPointerOver?.(event);
			}}
			onPointerMove={(event: PointerEvent<HTMLElement>) => {
				remember(event);
				onPointerMove?.(event);
			}}
			onPointerLeave={(event: PointerEvent<HTMLElement>) => {
				place(null);
				onPointerLeave?.(event);
			}}
			{...props}
		>
			<Layer
				ref={(node: HTMLElement | null) => {
					layer.current = node;
				}}
				aria-hidden
				role={Layer === 'li' ? 'none' : undefined}
				data-ui="hover-list-highlight"
				data-state="off"
				className={cn(highlightClassName)}
			/>
			{children}
		</Tag>
	);
}
