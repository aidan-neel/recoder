'use client';

import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from 'motion/react';

import { cn } from '../../lib/cn';
import { DURATION, EASE_IN, EASE_OUT } from '../../motion/presets';
import { GlyphFace, type GlyphKind } from './glyph-face';

export type { GlyphKind };

interface StatusGlyphProps {
	kind: GlyphKind;
	className?: string;
	/** Names the state for assistive tech. Without it the glyph is decorative and hidden. */
	label?: string;
}

/** A new face scales up from 0.7 out of a 2px blur; the old one scales back down and fades as it leaves. */
const FACE: Variants = {
	hidden: { opacity: 0, scale: 0.7, filter: 'blur(2px)' },
	shown: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: DURATION.toggle, ease: EASE_OUT } },
	gone: { opacity: 0, scale: 0.7, filter: 'blur(2px)', transition: { duration: DURATION.swap, ease: EASE_IN } }
};

/** Reduced motion: the faces only crossfade, so the old one never snaps to a smaller size as it fades. */
const FADE: Variants = {
	hidden: { opacity: 0 },
	shown: { opacity: 1, transition: { duration: DURATION.toggle, ease: EASE_OUT } },
	gone: { opacity: 0, transition: { duration: DURATION.swap, ease: EASE_IN } }
};

/**
 * One 16px glyph for every state an item can be in, so the queue, the rail and
 * the file list read alike. A change of kind morphs the face in place; the
 * first paint never animates.
 */
export function StatusGlyph({ kind, className, label }: StatusGlyphProps) {
	const reduced = useReducedMotionConfig();

	return (
		<span
			data-ui="status-glyph"
			data-kind={kind}
			role={label ? 'img' : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			className={cn(className)}
		>
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span
					key={kind}
					data-ui="status-glyph-face"
					data-kind={kind}
					variants={reduced ? FADE : FACE}
					initial="hidden"
					animate="shown"
					exit="gone"
				>
					<GlyphFace kind={kind} />
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
