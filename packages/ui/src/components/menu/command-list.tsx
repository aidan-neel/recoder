'use client';

import { Command, useCommandState } from 'cmdk';
import { animate, type AnimationPlaybackControls } from 'motion/react';
import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { SPRING } from '../../motion/presets';
import { MenuHighlight } from './menu-highlight';

/** cmdk marks the selected row `data-selected="true"`; pointer and arrow keys both move it. */
const SELECTED_ITEM = '[cmdk-item][data-selected="true"]';

/** True when the viewer asked for less motion; the list then snaps to its new height. */
function prefersStill(): boolean {
	return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Keeps `list` as tall as its results, up to its max height, and springs to
 * the new height when the results change. The first measure snaps, so the
 * palette opens at its size. Overflow is held while it grows so no scrollbar
 * flashes mid-spring. Returns the cleanup.
 */
function followContentHeight(list: HTMLElement): () => void {
	const first = list.firstElementChild;

	if (!(first instanceof HTMLElement)) return () => {};

	const sizer = first;
	let controls: AnimationPlaybackControls | undefined;
	let measured = false;

	/** The height the list should have now: its content, capped by its max height. */
	function target(): number {
		const max = Number.parseFloat(getComputedStyle(list).maxHeight);

		return Number.isNaN(max) ? sizer.offsetHeight : Math.min(sizer.offsetHeight, max);
	}

	/** Moves to the target height; springs unless this is the first measure or motion is reduced. */
	function follow(): void {
		const height = target();

		controls?.stop();

		if (!measured || prefersStill()) {
			measured = true;
			list.style.height = `${height}px`;

			return;
		}

		if (Math.abs(list.offsetHeight - height) < 1) return;

		list.style.overflowY = 'hidden';
		controls = animate(list, { height }, SPRING);
		controls.finished.then(() => list.style.removeProperty('overflow-y'));
	}

	const observer = new ResizeObserver(follow);

	observer.observe(sizer);
	window.addEventListener('resize', follow);

	return () => {
		observer.disconnect();
		window.removeEventListener('resize', follow);
		controls?.stop();
	};
}

/**
 * The palette's results: at most 420px tall, then it scrolls. It springs to a
 * new height as results change, and the traveling highlight follows the
 * selected row. An empty search shows the items in source order: cmdk sorts
 * by moving DOM nodes and never moves them back, so clearing the search
 * remounts the items.
 */
export function CommandList({ className, children }: { className?: string; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const searching = useCommandState((state) => state.search.length > 0);

	useLayoutEffect(() => {
		const list = ref.current;

		if (!list) return;

		return followContentHeight(list);
	}, []);

	return (
		<Command.List
			ref={ref}
			data-ui="command-list"
			className={cn('thin-scroll max-h-[min(420px,calc(86dvh-140px))] overflow-y-auto overscroll-contain', className)}
		>
			<MenuHighlight selector={SELECTED_ITEM} />
			<Fragment key={searching ? 'search' : 'all'}>{children}</Fragment>
		</Command.List>
	);
}
