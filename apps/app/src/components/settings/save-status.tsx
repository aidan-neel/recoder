'use client';

import { DURATION, EASE_OUT, Spinner } from '@recoder/ui';
import { Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import type { SaveState } from '@/lib/settings/use-save-state';

/** What a screen reader hears as a save moves along. */
const SPOKEN: Record<SaveState, string> = {
	idle: '',
	pending: 'Saving',
	success: 'Saved',
	error: 'Not saved'
};

/** Each face fades and grows in from 0.8, and leaves faster than it came. */
const FACE = {
	initial: { opacity: 0, scale: 0.8 },
	animate: { opacity: 1, scale: 1, transition: { duration: DURATION.swap, ease: EASE_OUT } },
	exit: { opacity: 0, scale: 0.8, transition: { duration: DURATION.menuOut } }
};

/** The glyph for a save in progress, landed or failed. */
function Face({ state }: { state: Exclude<SaveState, 'idle'> }) {
	if (state === 'pending') return <Spinner size={13} />;
	if (state === 'success') return <Check aria-hidden className="size-3.5 text-ok" strokeWidth={2.25} />;

	return <X aria-hidden className="size-3.5 text-danger" strokeWidth={2.25} />;
}

/**
 * A 16px slot beside a control that saves on change: a spinner while the save
 * runs, then a check or a cross for a moment. Empty and quiet the rest of the
 * time; it holds its width, so nothing beside it moves.
 */
export function SaveStatus({ state }: { state: SaveState }) {
	return (
		<span data-ui="save-status" role="status" className="save-status">
			<AnimatePresence initial={false} mode="popLayout">
				{state === 'idle' ? null : (
					<motion.span key={state} variants={FACE} initial="initial" animate="animate" exit="exit" className="flex">
						<Face state={state} />
					</motion.span>
				)}
			</AnimatePresence>
			<span className="sr-only">{SPOKEN[state]}</span>
		</span>
	);
}
