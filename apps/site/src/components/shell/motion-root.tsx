'use client';

import { IconRoot } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { followSystemTheme } from '@/lib/shell/theme';

/**
 * Kit motion (the nav pill, the waitlist swap) turns into plain swaps when the visitor asks for reduced motion, and
 * the icons draw at the kit's weight. The theme follows the device, as the app's does, until the visitor switches it.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
	useEffect(followSystemTheme, []);

	return (
		<MotionConfig reducedMotion="user">
			<IconRoot>{children}</IconRoot>
		</MotionConfig>
	);
}
