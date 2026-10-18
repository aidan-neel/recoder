'use client';

import {
	Collapsible,
	CollapsibleContent,
	Field,
	StatusGlyph,
	swapMotion,
	Textarea,
	useMotionVariants
} from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';

import { decisionGlyph, STATE_LABEL } from '@/lib/review/labels';
import { useReview } from '@/lib/review/review-store';
import type { Decision, DecisionState } from '@/lib/review/surface';

/** A decided item's note and the setter that saves it. Typing never decides: an item never decided keeps no note. */
export function useNote(id: string): [string, (note: string) => void] {
	const note = useReview((state) => state.records[id]?.note ?? '');

	return [note, (next) => useReview.getState().setNote(id, next)];
}

/**
 * The decided state at the end of the kicker: its glyph and a quiet label. It
 * fades in and out as the item is decided or reopened, and a change between
 * decided states morphs the glyph and crossfades the label.
 */
export function StateLine({ decision, state }: { decision: Decision; state: DecisionState }) {
	const swap = useMotionVariants(swapMotion);

	return (
		<AnimatePresence initial={false}>
			{state === 'open' ? null : (
				<motion.span
					key="state"
					variants={swap}
					initial="initial"
					animate="animate"
					exit="exit"
					className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-fg-subtle"
				>
					<StatusGlyph kind={decisionGlyph(decision, state)} />
					<span className="relative inline-grid">
						<AnimatePresence initial={false} mode="popLayout">
							<motion.span key={state} variants={swap} initial="initial" animate="animate" exit="exit">
								{STATE_LABEL[state]}
							</motion.span>
						</AnimatePresence>
					</span>
				</motion.span>
			)}
		</AnimatePresence>
	);
}

/** The note field under a sent-back decision. It unfolds when the item is sent back while open on screen. */
export function SentNote({ id, sent }: { id: string; sent: boolean }) {
	const [note, setNote] = useNote(id);

	return (
		<Collapsible open={sent}>
			<CollapsibleContent className="pt-[22px]">
				<Field label="Note for the agent">
					<Textarea
						autosize
						minRows={2}
						maxRows={12}
						placeholder="Optional. Anything the agent should know when it fixes this."
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				</Field>
			</CollapsibleContent>
		</Collapsible>
	);
}
