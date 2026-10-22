'use client';

import { cn, DURATION, EASE_OUT } from '@recoder/ui';
import { motion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A box whose height follows its content, easing to each new height instead
 * of snapping, so what sits below slides rather than jumps. It paints at its
 * height first, and clips while it moves.
 */
export function SmoothHeight({ children, className }: { children: ReactNode; className?: string }) {
	const inner = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number | 'auto'>('auto');

	useLayoutEffect(() => {
		const element = inner.current;

		if (!element) return;

		const observer = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize[0]?.blockSize ?? 'auto'));

		observer.observe(element);

		return () => observer.disconnect();
	}, []);

	return (
		<motion.div
			initial={false}
			animate={{ height }}
			transition={{ duration: DURATION.toggle, ease: EASE_OUT }}
			className={cn('overflow-hidden', className)}
		>
			<div ref={inner}>{children}</div>
		</motion.div>
	);
}
