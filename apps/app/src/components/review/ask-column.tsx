'use client';

import { DURATION, EASE_IN, EASE_OUT } from '@recoder/ui';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';

import { AskPanel } from '@/components/ask/ask-panel';
import { focusComposer } from '@/lib/ask/focus-request';
import { useReview } from '@/lib/review/review-store';

import { focusReadingPane } from './reading-viewport';

/** The column's open width (380px, in rem so it scales with the root font size on large screens). */
const WIDTH = '23.75rem';

/** Collapsed, in the same unit, so the tween animates one unit. */
const CLOSED = '0rem';

/** A short tween each way, so the reading pane reflows for a moment rather than half a second. */
const OPEN: Transition = { duration: DURATION.toggle, ease: EASE_OUT };

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
 * The ask column beside the reading pane. It opens by growing to 380px on a
 * short tween while its content, fixed at that width, fades in; it collapses
 * faster. Reduced motion swaps it at once. Opening puts focus in the column;
 * closing, by any path, puts it back, and the closing column takes no focus.
 */
export function AskColumn() {
	const open = useReview((state) => state.askOpen);
	const reduced = useReducedMotion();
	const column = useRef<HTMLElement>(null);
	const before = useRef<HTMLElement | null>(null);
	const wasOpen = useRef(false);

	useLayoutEffect(() => {
		if (open === wasOpen.current) return;

		wasOpen.current = open;

		if (open) {
			const active = document.activeElement;

			before.current =
				active instanceof HTMLElement && active !== document.body && !column.current?.contains(active) ? active : null;

			column.current?.removeAttribute('inert');
			focusComposer(column.current?.querySelector('[data-ask-panel]') ?? null);

			return;
		}

		focusBack(column.current, before.current);
		column.current?.setAttribute('inert', '');
	}, [open]);

	return (
		<AnimatePresence initial={false}>
			{open ? (
				<motion.aside
					key="ask"
					ref={column}
					data-ui="ask-column"
					className="ask-column"
					initial={{ width: CLOSED }}
					animate={{ width: WIDTH, transition: reduced ? INSTANT : OPEN }}
					exit={{ width: CLOSED, transition: reduced ? INSTANT : CLOSE }}
				>
					<motion.div
						className="ask-column-inner"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1, transition: reduced ? INSTANT : OPEN }}
						exit={{ opacity: 0, transition: reduced ? INSTANT : { duration: DURATION.menuOut } }}
					>
						<AskPanel />
					</motion.div>
				</motion.aside>
			) : null}
		</AnimatePresence>
	);
}
