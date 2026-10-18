'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/** Kit motion (the nav pill, the waitlist swap) turns into plain swaps when the visitor asks for reduced motion. */
export function MotionRoot({ children }: { children: ReactNode }) {
	return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
