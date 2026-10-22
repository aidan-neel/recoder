'use client';

import { StatusGlyph, swapMotion, useMotionVariants } from '@recoder/ui';
import { AnimatePresence, motion, type Variants } from 'motion/react';

import { askTitle, askWhere, type AskItem } from '@/lib/ask/item';
import { STATE_LABEL, TONE_LABEL, decisionGlyph, plain } from '@/lib/review/labels';
import type { DecisionState } from '@/lib/review/surface';

/** The glyph and its spoken label: a decision's tone, or what was decided; a receipt is checked. */
function glyphOf(item: AskItem, state: DecisionState) {
	if (item.kind === 'receipt') return { kind: 'ok' as const, label: 'Checked' };

	return {
		kind: decisionGlyph(item.decision, state),
		label: state === 'open' ? TONE_LABEL[item.decision.tone] : STATE_LABEL[state]
	};
}

/**
 * The chip's text rises in like any swap but leaves at once, so two titles
 * never overlap while the reader steps through decisions.
 */
const CHIP_SWAP: Variants = {
	initial: swapMotion.initial,
	animate: swapMotion.animate,
	exit: { opacity: 0, transition: { duration: 0 } }
};

/**
 * What the questions are about: the selected decision or receipt, by title
 * and place. Moving to another item swaps the text inside a chip that stays put.
 */
export function AskContext({ item, state }: { item: AskItem; state: DecisionState }) {
	const chip = useMotionVariants(CHIP_SWAP);
	const glyph = glyphOf(item, state);

	return (
		<div className="shrink-0 px-3 pt-3">
			<div data-ui="ask-context">
				<AnimatePresence initial={false} mode="popLayout">
					<motion.div
						key={item.key}
						className="flex min-w-0 flex-1 items-start gap-2.5"
						variants={chip}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						<StatusGlyph kind={glyph.kind} label={glyph.label} className="mt-px" />
						<div className="min-w-0 flex-1">
							<p className="line-clamp-2 text-[13px] leading-[18px] text-fg">{plain(askTitle(item))}</p>
							<p className="mt-1 truncate font-mono text-[11px] leading-4 text-fg-faint">{askWhere(item)}</p>
						</div>
					</motion.div>
				</AnimatePresence>
			</div>
		</div>
	);
}
