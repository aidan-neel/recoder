'use client';

import { DURATION, EASE_IN, EASE_OUT } from '@recoder/ui';
import { motion, type Variants } from 'motion/react';
import type { ReactNode, Ref } from 'react';

/** A new message rises 4px and fades in; one taken back fades out fast. */
const RISE: Variants = {
	initial: { opacity: 0, y: 4 },
	animate: { opacity: 1, y: 0, transition: { duration: DURATION.swap, ease: EASE_OUT } },
	exit: { opacity: 0, transition: { duration: DURATION.menuOut, ease: EASE_IN } }
};

interface ChatRowProps {
	children: ReactNode;
	className?: string;
	ref?: Ref<HTMLDivElement>;
}

/**
 * One entry in a transcript. Inside an `AnimatePresence initial={false}`,
 * entries there at first paint stay still and later ones rise in.
 */
export function ChatRow({ children, className, ref }: ChatRowProps) {
	return (
		<motion.div ref={ref} variants={RISE} initial="initial" animate="animate" exit="exit" className={className}>
			{children}
		</motion.div>
	);
}
