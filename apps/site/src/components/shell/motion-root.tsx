'use client';

import { IconRoot } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Kit motion (the nav pill, the waitlist swap) turns into plain swaps when the visitor asks for reduced motion, and
 * the icons draw at the kit's weight.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
	return (
		<MotionConfig reducedMotion="user">
			<IconRoot>{children}</IconRoot>
		</MotionConfig>
	);
}
