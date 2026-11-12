'use client';

import { DURATION, EASE_IN, EASE_OUT } from '@recoder/ui';
import { AnimatePresence, motion, useReducedMotionConfig, type Transition } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { AskPanel } from '@/components/ask/ask-panel';
import { TranscriptHold } from '@/components/ask/chat-scroll';
import { focusComposer } from '@/lib/ask/focus-request';
import { useReview } from '@/lib/review/review-store';

import { focusReadingPane } from './reading-viewport';

/** The column's open width (380px, in rem so it scales with the root font size on large screens). */
const WIDTH = '23.75rem';

/** Collapsed, in the same unit, so the tween animates one unit. */
const CLOSED = '0rem';

/** A short tween each way (140ms), so the reading pane reflows for a moment and q never waits on it. */
const OPEN: Transition = { duration: DURATION.swap, ease: EASE_OUT };

const CLOSE: Transition = { duration: DURATION.swap, ease: EASE_IN };

const INSTANT: Transition = { duration: 0 };

/**
 * Hands focus back when the column closes, unless the person already moved
 * it elsewhere: to what had it before the column opened, else to the reading
 * pane, else to the page.
 */
function focusBack(column: HTMLElement | null, before: HTMLElement | null): void {
	const active = document.activeElement;

	if (active && active !== document.body && !column?.contains(active)) return;

	if (before?.isConnected && !column?.contains(before)) {
		before.focus({ preventScroll: true });

		if (document.activeElement === before) return;
	}

	if (focusReadingPane()) return;

	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * True when the column, at the right edge of the review body at its open
 * width, hides half or more of `panel`'s width. It uses the open width, not
 * the column's tweening one, so the answer holds from the open's first frame.
 */
function hides(panel: Element, body: Element, width: number): boolean {
	const area = body.getBoundingClientRect();
	const box = panel.getBoundingClientRect();
	const left = area.right - Math.min(width, area.width);
	const overlap = Math.min(box.right, area.right) - Math.max(box.left, left);

	return overlap * 2 >= box.width;
}

/**
 * Below 960px the open column lies over the rail and the reading pane
 * (ask.css). While it does, each panel it mostly hides goes inert, so Tab and
 * clicks never reach a control under it, and focus caught in one moves to
 * the composer. A panel it only clips stays live. The panels come back as the
 * column closes, before focus returns to them, or as the window widens.
 */
function useInertUnderColumn(column: RefObject<HTMLElement | null>, open: boolean): void {
	useLayoutEffect(() => {
		const aside = column.current;
		const body = aside?.parentElement;
		const inner = aside?.firstElementChild;

		if (!open || !aside || !body || !inner) return;

		const marked = new Set<Element>();

		const release = () => {
			for (const panel of marked) panel.removeAttribute('inert');

			marked.clear();
		};

		const sync = () => {
			release();

			if (getComputedStyle(aside).position !== 'absolute') return;

			const width = inner.getBoundingClientRect().width;

			const panels = [...body.children].filter(
				(panel) => panel !== aside && !panel.hasAttribute('inert') && hides(panel, body, width)
			);

			const caught = panels.some((panel) => panel.contains(document.activeElement));

			for (const panel of panels) {
				panel.setAttribute('inert', '');
				marked.add(panel);
			}

			if (caught) focusComposer(aside.querySelector('[data-ask-panel]') ?? aside);
		};

		const sizes = new ResizeObserver(sync);

		sizes.observe(body);

		return () => {
			sizes.disconnect();
			release();
		};
	}, [column, open]);
}

/**
 * False for the commit that opens the column, true once a frame has drawn
 * it. The work the open can put off waits for it, so that commit stays light.
 */
function usePainted(): boolean {
	const [painted, setPainted] = useState(false);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setPainted(true));

		return () => cancelAnimationFrame(frame);
	}, []);

	return painted;
}

/**
 * The open column: it grows to 380px while its content, fixed at that width,
 * fades in, and collapses as fast. The commit that opens it mounts only the
 * edge, the header's title and the composer's field, so that commit stays
 * light and focus lands in the field at once. The rest (the close and send
 * buttons, the context chip, the scroll area and its transcript) mounts a
 * frame later. The content stays transparent until then, and its fade waits
 * for that frame, so the content fades in whole. Reduced motion swaps it at
 * once, everything included.
 */
function Column({ column }: { column: RefObject<HTMLElement | null> }) {
	const reduced = useReducedMotionConfig();
	const painted = usePainted();
	const held = !painted && !reduced;

	return (
		<motion.aside
			ref={column}
			data-ui="ask-column"
			tabIndex={-1}
			className="ask-column"
			initial={{ width: CLOSED }}
			animate={{ width: WIDTH, transition: reduced ? INSTANT : OPEN }}
			exit={{ width: CLOSED, transition: reduced ? INSTANT : CLOSE }}
		>
			<motion.div
				className="ask-column-inner"
				initial={{ opacity: 0 }}
				animate={{ opacity: held ? 0 : 1, transition: reduced ? INSTANT : OPEN }}
				exit={{ opacity: 0, transition: reduced ? INSTANT : { duration: DURATION.menuOut } }}
			>
				<TranscriptHold value={held}>
					<AskPanel />
				</TranscriptHold>
			</motion.div>
		</motion.aside>
	);
}

/**
 * The ask column beside the reading pane. Its tween lays out and repaints the
 * pane each frame, which a 4x CPU trace puts at about 1ms of layout and 2 to
 * 4ms of paint a frame. In a narrow window it lies over the rail and the
 * pane, and the panels it hides go inert. Opening puts focus in the composer;
 * closing, by any path, puts it back, and the closing column takes no focus.
 */
export function AskColumn() {
	const open = useReview((state) => state.askOpen);
	const column = useRef<HTMLElement>(null);
	const before = useRef<HTMLElement | null>(null);
	const wasOpen = useRef(false);

	useInertUnderColumn(column, open);

	useLayoutEffect(() => {
		if (open === wasOpen.current) return;

		wasOpen.current = open;

		if (open) {
			const active = document.activeElement;

			before.current =
				active instanceof HTMLElement && active !== document.body && !column.current?.contains(active) ? active : null;

			const panel = column.current?.querySelector('[data-ask-panel]');

			column.current?.removeAttribute('inert');

			if (panel) focusComposer(panel);
			else column.current?.focus({ preventScroll: true });

			return;
		}

		focusBack(column.current, before.current);
		column.current?.setAttribute('inert', '');
	}, [open]);

	return <AnimatePresence initial={false}>{open ? <Column key="ask" column={column} /> : null}</AnimatePresence>;
}
