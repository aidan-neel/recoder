'use client';

import { MotionConfig } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { followSystemTheme } from '@/lib/shell/theme';

/**
 * Kit motion (the nav pill, the waitlist swap) turns into plain swaps when the visitor asks for reduced motion. The
 * theme follows the device, as the app's does, until the visitor switches it.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
	useEffect(followSystemTheme, []);

	return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
