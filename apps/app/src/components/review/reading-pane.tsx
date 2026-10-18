'use client';

import { DURATION, EASE_OUT, ScrollArea } from '@recoder/ui';
import { motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';

import { DecisionBar } from '@/components/decision/decision-bar';
import { DecisionView } from '@/components/decision/decision-view';
import { FileView } from '@/components/decision/file-view';
import { ReceiptView } from '@/components/decision/receipt-view';
import { ReviewRunning } from '@/components/live/review-running';
import { selectionKey, useReview, type Selection } from '@/lib/review/review-store';

import { LiveStrip } from './live-strip';
import { OverviewView } from './overview-view';
import { isWorking, useCounts, usePhase } from './review-view';

/** What the pane shows for a selection. While reviewers work and nothing is found yet, the overview is the live view. */
function PaneContent({ selection, live }: { selection: Selection; live: boolean }) {
	if (selection.kind === 'decision') return <DecisionView id={selection.id} />;
	if (selection.kind === 'receipt') return <ReceiptView id={selection.id} />;
	if (selection.kind === 'file') return <FileView path={selection.path} />;

	return live ? <ReviewRunning /> : <OverviewView />;
}

/**
 * Makes the pane's scroller a stop for the keyboard: it takes focus (with a
 * ring) and lets the page's arrows and j/k walk the rail through it, while
 * Space and Page Down scroll it.
 */
const VIEWPORT = { tabIndex: 0, role: 'region', 'aria-label': 'Reading pane', 'data-page-keys': 'move' };

/**
 * The reading pane. Each selection opens at its top with no scroll animation
 * and swaps in with at most a short opacity fade, so keyboard moves stay
 * instant. A running review with decisions keeps a live strip on top; the
 * decision bar floats over the bottom while a decision is selected. When a
 * control inside the pane opens another item (a receipt, the file, the
 * riskiest decision), the control goes away with the old view, so focus
 * moves to the pane instead of dropping to the page.
 */
export function ReadingPane() {
	const selection = useReview((state) => state.selection);
	const phase = usePhase();
	const { total } = useCounts();
	const viewport = useRef<HTMLDivElement | null>(null);
	const activated = useRef(false);
	const key = selectionKey(selection);
	const [firstKey] = useState(key);
	const working = isWorking(phase);

	/** Remembers, until the event finishes, that a control inside the pane was pressed. */
	function onClickCapture(): void {
		activated.current = true;
		setTimeout(() => (activated.current = false));
	}

	useLayoutEffect(() => {
		const element = viewport.current;

		element?.scrollTo({ top: 0, behavior: 'instant' });

		if (element && activated.current && (!document.activeElement || document.activeElement === document.body)) {
			element.focus({ preventScroll: true });
		}
	}, [key]);

	return (
		<div data-ui="reading-pane" className="review-main">
			{working && phase !== 'draft' && total > 0 ? <LiveStrip /> : null}
			<ScrollArea className="flex-1" viewportRef={viewport} viewportProps={VIEWPORT} viewportClassName="review-scroll">
				<motion.div
					key={key}
					initial={key === firstKey ? false : { opacity: 0.55 }}
					animate={{ opacity: 1 }}
					transition={{ duration: DURATION.menuOut, ease: EASE_OUT }}
					onClickCapture={onClickCapture}
				>
					<PaneContent selection={selection} live={working && total === 0} />
				</motion.div>
			</ScrollArea>
			<DecisionBar />
		</div>
	);
}
