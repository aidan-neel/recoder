'use client';

import { motion, useReducedMotionConfig } from 'motion/react';

import { cn } from '../../lib/cn';
import { SPRING } from '../../motion/presets';

/** The fill color: neutral progress, or a state worth noticing. */
export type MeterTone = 'neutral' | 'ok' | 'medium' | 'high';

interface MeterProps {
	/** Progress from 0 to `max`, or null while the amount is unknown (a short bar slides along the track). */
	value: number | null;
	max?: number;
	tone?: MeterTone;
	className?: string;
	'aria-label': string;
}

/** The fill's share of the track, as a CSS percentage clamped to 0–100. */
function percent(value: number, max: number): string {
	const share = max > 0 ? value / max : 0;

	return `${Math.min(1, Math.max(0, share)) * 100}%`;
}

/**
 * A 3px progress track. The fill springs to a new width when the value
 * changes and paints at its width on first render. A null value shows the
 * indeterminate state.
 */
export function Meter({ value, max = 1, tone = 'neutral', className, 'aria-label': label }: MeterProps) {
	const reduced = useReducedMotionConfig();
	const indeterminate = value === null;

	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={indeterminate ? undefined : Math.min(max, Math.max(0, value))}
			data-ui="meter"
			data-tone={tone}
			data-state={indeterminate ? 'indeterminate' : 'determinate'}
			className={cn('relative h-[3px] w-full overflow-hidden rounded-full bg-line-subtle', className)}
		>
			{indeterminate ? (
				<span data-ui="meter-fill" className="absolute inset-y-0 left-0 w-[32%] rounded-full" />
			) : (
				<motion.span
					data-ui="meter-fill"
					className="absolute inset-y-0 left-0 rounded-full"
					initial={false}
					animate={{ width: percent(value, max) }}
					transition={reduced ? { duration: 0 } : SPRING}
				/>
			)}
		</div>
	);
}
