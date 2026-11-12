'use client';

import {
	Button,
	cn,
	Collapsible,
	CollapsibleContent,
	DURATION,
	EASE_OUT,
	Field,
	StatusGlyph,
	swapMotion,
	Textarea,
	useMotionVariants
} from '@recoder/ui';
import { AnimatePresence, motion, useIsPresent, type Variants } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';

import { focusReadingPane } from '@/components/review/reading-viewport';
import { stateOf } from '@/lib/review/decisions';
import { retryDismissal, useDismissalPhase } from '@/lib/review/dismissal-sync';
import { decisionGlyph, STATE_LABEL } from '@/lib/review/labels';
import { useReview } from '@/lib/review/review-store';
import type { Decision, DecisionState } from '@/lib/review/surface';

/**
 * The kit's swap, with the entrance held as long as the leave (80ms), so the
 * old words are gone before the new ones show (a wait swap).
 */
const WAIT_SWAP: Variants = {
	...swapMotion,
	animate: { opacity: 1, y: 0, transition: { duration: DURATION.swap, ease: EASE_OUT, delay: DURATION.menuOut } }
};

/** A decided item's note and the setter that saves it. Typing never decides: an item never decided keeps no note. */
export function useNote(id: string): [string, (note: string) => void] {
	const note = useReview((state) => state.records[id]?.note ?? '');

	return [note, (next) => useReview.getState().setNote(id, next)];
}

/** A decision's state, read where it shows, so the rest of the detail never re-renders when it changes. */
function useDecisionState(id: string): DecisionState {
	return useReview((store) => stateOf(store.records, id));
}

/**
 * Words that swap in wait mode where they stand (see {@link WAIT_SWAP}); the
 * old ones leave out of the flow. It runs in motion, not the kit's CSS
 * `SwapText mode="wait"`: a decision changes as the review moves on, while
 * the reading pane keeps its item mounted but skipped (`content-visibility:
 * hidden`), where a CSS animation would wait to play until the person stepped
 * back, and the words would then fade in late.
 */
function WaitText({ text, className }: { text: string; className?: string }) {
	const wait = useMotionVariants(WAIT_SWAP);

	return (
		<span className={cn('relative inline-grid whitespace-nowrap', className)}>
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span key={text} variants={wait} initial="initial" animate="animate" exit="exit">
					{text}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}

interface RetryProps {
	reviewId: string;
	findingId: string;
	/** True while a write is on its way: a slow first save, or the one Try again sent. */
	pending: boolean;
}

/**
 * The note's Try again: a spinner of the same width while a write is on its
 * way, so a slow save that fails turns into Try again in place. When the note
 * leaves with focus on the button (the write landed), focus goes to the
 * reading pane rather than dropping to the page.
 */
function RetryButton({ reviewId, findingId, pending }: RetryProps) {
	const button = useRef<HTMLButtonElement>(null);
	const present = useIsPresent();

	useLayoutEffect(() => {
		if (!present && button.current === document.activeElement) focusReadingPane();
	}, [present]);

	return (
		<Button
			ref={button}
			variant="ghost"
			status={pending ? 'pending' : 'idle'}
			className="unsaved-retry"
			onClick={() => retryDismissal(reviewId, findingId)}
		>
			Try again
		</Button>
	);
}

/**
 * A quiet note while the server may not have the finding's dismissal or
 * restore: Saving with a spinner while a slow write is on its way, then Not
 * saved with a Try again that sends it again if it fails. A save that lands
 * quickly shows nothing. The decision itself stays as the person left it.
 * The note comes and goes with the state's own fade, its words swap in wait
 * mode, and it is there at once when the item opens, after a reload too.
 */
function UnsavedNote({ decision, state }: { decision: Decision; state: DecisionState }) {
	const swap = useMotionVariants(swapMotion);
	const reviewId = useReview((store) => store.review?.id);
	const findingId = decision.finding?.id;
	const phase = useDismissalPhase(reviewId, findingId, state);

	return (
		<AnimatePresence initial={false}>
			{phase && reviewId && findingId ? (
				<motion.span
					key="unsaved"
					variants={swap}
					initial="initial"
					animate="animate"
					exit="exit"
					className="inline-flex items-center gap-1.5"
				>
					<WaitText text={phase === 'saving' ? 'Saving' : 'Not saved'} className="text-fg-faint" />
					<RetryButton reviewId={reviewId} findingId={findingId} pending={phase !== 'failed'} />
				</motion.span>
			) : null}
		</AnimatePresence>
	);
}

/**
 * The decided state at the end of the kicker: its glyph and a quiet label,
 * after the Saving or Not saved note while the server may not have it. It
 * fades in and out as the item is decided or reopened, and a change between
 * decided states morphs the glyph and swaps the label in wait mode, so the
 * old and new labels never show at once. The note sits before the label, so
 * the label holds its place as the note comes and goes, and the line takes no
 * room in the kicker while it holds neither.
 */
export function StateLine({ decision }: { decision: Decision }) {
	const swap = useMotionVariants(swapMotion);
	const state = useDecisionState(decision.id);

	return (
		<span className="ml-auto inline-flex items-center gap-3 text-[12.5px] text-fg-subtle empty:hidden">
			<UnsavedNote decision={decision} state={state} />
			<AnimatePresence initial={false}>
				{state === 'open' ? null : (
					<motion.span
						key="state"
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
						className="inline-flex items-center gap-2"
					>
						<StatusGlyph kind={decisionGlyph(decision, state)} />
						<WaitText text={STATE_LABEL[state]} />
					</motion.span>
				)}
			</AnimatePresence>
		</span>
	);
}

/** The note field itself: a decided item's words for the agent, saved as they are typed. */
function NoteField({ id }: { id: string }) {
	const [note, setNote] = useNote(id);

	return (
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
	);
}

/**
 * The note field under a sent-back decision. Sending back advances to the
 * next decision, so the field is there when the person comes back to the
 * item, with no fold to watch. While the item is on screen, a change folds it
 * by height: Undo on a sent item folds the field away.
 */
export function SentNote({ id }: { id: string }) {
	const sent = useDecisionState(id) === 'sent';
	const shown = useReview((store) => store.selection.kind === 'decision' && store.selection.id === id);

	if (!shown) {
		return sent ? (
			<div className="pt-[22px]">
				<NoteField id={id} />
			</div>
		) : null;
	}

	return (
		<Collapsible open={sent}>
			<CollapsibleContent className="pt-[22px]">
				<NoteField id={id} />
			</CollapsibleContent>
		</Collapsible>
	);
}
