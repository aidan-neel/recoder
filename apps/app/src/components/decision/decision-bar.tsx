'use client';

import {
	AnimatedNumber,
	Button,
	DURATION,
	EASE_IN,
	EASE_OUT,
	Keycap,
	StatusGlyph,
	swapMotion,
	Tooltip,
	useMotionVariants
} from '@recoder/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, type Variants } from 'motion/react';
import { useLayoutEffect, useRef, type MouseEvent, type ReactElement, type RefObject } from 'react';

import { focusReadingPane } from '@/components/review/reading-viewport';
import { stateOf } from '@/lib/review/decisions';
import { decisionGlyph } from '@/lib/review/labels';
import { sameSelection, selectionOrder, surfaceOf, useReview } from '@/lib/review/review-store';
import type { Decision, DecisionState, Outcome } from '@/lib/review/surface';

/** What each outcome means, said once the item is decided. */
const DONE: Record<Outcome, string> = {
	accepted: 'Accepted. It ships as is.',
	sent: 'Sent back. It goes to the agent in the handoff.',
	dismissed: 'Not an issue. Recoder won’t raise it again.'
};

/** The bar rises a few pixels as it fades in, and sinks back as it leaves, once there is no decision to act on. */
const BAR: Variants = {
	hidden: { opacity: 0, y: 8, transition: { duration: DURATION.menuOut, ease: EASE_IN } },
	shown: { opacity: 1, y: 0, transition: { duration: DURATION.toggle, ease: EASE_OUT } }
};

/**
 * The likely call is the filled button: send back real risks and open
 * questions, accept low and quality findings. Positions never move.
 */
function sendIsLikely(decision: Decision): boolean {
	return !decision.quality && decision.tone !== 'low';
}

function decide(id: string, state: Outcome): void {
	useReview.getState().decide(id, state);
}

/**
 * After a click with the pointer, focus goes to the reading pane, so Space
 * and Page Down read on instead of pressing the button again. A key press on
 * a focused button (`detail` 0) keeps focus in the bar.
 */
function readOnAfterClick(event: MouseEvent<HTMLElement>): void {
	if (event.detail > 0 && (event.target as Element).closest('button')) focusReadingPane();
}

/** A button with a tooltip, wrapped when disabled so the tooltip still has a target that takes pointer events. */
function Tipped({
	label,
	shortcut,
	disabled,
	children
}: {
	label: string;
	shortcut: string;
	disabled: boolean;
	children: ReactElement;
}) {
	return (
		<Tooltip content={label} shortcut={shortcut}>
			{disabled ? <span className="inline-flex">{children}</span> : children}
		</Tooltip>
	);
}

interface BarProps {
	decision: Decision;
	state: DecisionState;
	index: number;
	total: number;
	last: boolean;
}

/**
 * When the bar swaps faces with focus inside it, focus moves to `target` in
 * the new face (the face going out is still in the page while it fades), so
 * it never drops to the page and Enter keeps working.
 */
function useTakeFocus(target: RefObject<HTMLButtonElement | null>): void {
	useLayoutEffect(() => {
		const button = target.current;
		const active = document.activeElement;
		const bar = button?.closest('[data-ui="decide-bar"]');

		if (button && active && active !== button && bar?.contains(active)) button.focus({ preventScroll: true });
	}, [target]);
}

/**
 * The three outcomes, the likely one filled. "Not an issue" is for findings;
 * a question can only be settled. Each button is named by its label alone;
 * the keycap it shows is its shortcut.
 */
function Actions({ decision }: { decision: Decision }) {
	const send = sendIsLikely(decision);
	const likely = useRef<HTMLButtonElement>(null);
	const other = useRef<HTMLButtonElement>(null);

	useTakeFocus(likely);

	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<Button
				ref={send ? other : likely}
				variant={send ? 'outline' : 'primary'}
				className="gap-2"
				aria-label="Accept"
				aria-keyshortcuts="A"
				onClick={() => decide(decision.id, 'accepted')}
			>
				Accept <Keycap k="a" />
			</Button>
			<Button
				ref={send ? likely : other}
				variant={send ? 'primary' : 'outline'}
				className="gap-2"
				aria-label="Send back"
				aria-keyshortcuts="S"
				onClick={() => decide(decision.id, 'sent')}
			>
				Send back <Keycap k="s" />
			</Button>
			{decision.kind === 'finding' ? (
				<Button
					variant="ghost"
					className="gap-2"
					aria-label="Not an issue"
					aria-keyshortcuts="X"
					onClick={() => decide(decision.id, 'dismissed')}
				>
					Not an issue <Keycap k="x" />
				</Button>
			) : null}
		</div>
	);
}

/**
 * What was decided, in a sentence, with Undo at the end. Undo reopens this
 * decision; its keycap shows only while it was also the last change, since
 * u undoes the last change wherever it was made.
 */
function Done({ decision, state }: { decision: Decision; state: Outcome }) {
	const swap = useMotionVariants(swapMotion);
	const undo = useRef<HTMLButtonElement>(null);
	const lastChange = useReview((store) => store.history.at(-1)?.id === decision.id);

	useTakeFocus(undo);

	return (
		<div className="flex min-w-0 items-center gap-2.5 pl-0.5">
			<StatusGlyph kind={decisionGlyph(decision, state)} />
			<span className="relative grid min-w-0 flex-1">
				<AnimatePresence initial={false} mode="popLayout">
					<motion.span
						key={state}
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
						className="truncate text-[13px] text-fg-secondary"
					>
						{DONE[state]}
					</motion.span>
				</AnimatePresence>
			</span>
			<Button
				ref={undo}
				variant="ghost"
				className="gap-2"
				aria-label="Undo"
				aria-keyshortcuts={lastChange ? 'U' : undefined}
				onClick={() => useReview.getState().reopen(decision.id)}
			>
				Undo {lastChange ? <Keycap k="u" /> : null}
			</Button>
		</div>
	);
}

/** When the bar starts to leave with focus inside it, focus moves to the reading pane instead of the page. */
function useHandFocusOnExit(bar: RefObject<HTMLDivElement | null>): void {
	const present = useIsPresent();

	useLayoutEffect(() => {
		if (!present && bar.current?.contains(document.activeElement)) focusReadingPane();
	}, [present, bar]);
}

/**
 * The floating bar. Its props are the parent's, so a bar fading out keeps the
 * face it had. A button's own click runs before the bar's, so a pointer
 * decision is made before focus moves to the reading pane.
 */
function Bar({ decision, state, index, total, last }: BarProps) {
	const swap = useMotionVariants(swapMotion);
	const step = (by: number) => useReview.getState().step(by);
	const bar = useRef<HTMLDivElement>(null);

	useHandFocusOnExit(bar);

	return (
		<motion.div
			variants={BAR}
			initial="hidden"
			animate="shown"
			exit="hidden"
			className="pointer-events-none absolute inset-x-0 bottom-0 z-[5]"
		>
			<div aria-hidden="true" className="decide-fade" />
			<div
				ref={bar}
				role="group"
				aria-label="Decide"
				data-ui="decide-bar"
				className="decide-bar"
				onClick={readOnAfterClick}
			>
				<div className="relative grid min-w-0 flex-1">
					<AnimatePresence initial={false} mode="popLayout">
						<motion.div
							key={state === 'open' ? 'actions' : 'done'}
							variants={swap}
							initial="initial"
							animate="animate"
							exit="exit"
							className="min-w-0"
						>
							{state === 'open' ? <Actions decision={decision} /> : <Done decision={decision} state={state} />}
						</motion.div>
					</AnimatePresence>
				</div>

				<div className="flex shrink-0 items-center gap-0.5">
					<span className="mr-1.5 text-[12px] text-fg-faint tabular-nums">
						<AnimatedNumber value={index + 1} /> of {total}
					</span>
					<Tipped label="Previous" shortcut="k" disabled={false}>
						<Button variant="ghost" size="icon" aria-label="Previous" onClick={() => step(-1)}>
							<ChevronUp />
						</Button>
					</Tipped>
					<Tipped label="Next" shortcut="j" disabled={last}>
						<Button variant="ghost" size="icon" aria-label="Next" disabled={last} onClick={() => step(1)}>
							<ChevronDown />
						</Button>
					</Tipped>
				</div>
			</div>
		</motion.div>
	);
}

/**
 * Accept, send back or dismiss the selected decision. Deciding advances the
 * review at once and the bar stays where it is; it fades away when no
 * decision is selected. The review page binds the keys the keycaps name.
 */
export function DecisionBar() {
	const surface = useReview(surfaceOf);
	const selection = useReview((store) => store.selection);

	const state = useReview((store) =>
		store.selection.kind === 'decision' ? stateOf(store.records, store.selection.id) : 'open'
	);

	const last = useReview((store) => {
		const order = selectionOrder(store);

		return sameSelection(order[order.length - 1], store.selection);
	});

	const decisions = surface?.decisions ?? [];
	const index = selection.kind === 'decision' ? decisions.findIndex((item) => item.id === selection.id) : -1;
	const decision = index >= 0 ? decisions[index] : null;

	return (
		<AnimatePresence initial={false}>
			{decision ? (
				<Bar key="bar" decision={decision} state={state} index={index} total={decisions.length} last={last} />
			) : null}
		</AnimatePresence>
	);
}
