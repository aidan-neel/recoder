'use client';

import { motion, type Transition } from 'motion/react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';

/**
 * The switch's geometry in px. The track's CSS stays in px too (the app's
 * px-to-rem step skips `[data-ui='switch']`), so the thumb's travel lines up
 * at every root size.
 */
const TRACK = 28;
const INSET = 2;
const THUMB = 12;
const TRAVEL = TRACK - INSET * 2 - THUMB;

/** The toggle springs with a little overshoot. */
const TOGGLE: Transition = { type: 'spring', stiffness: 560, damping: 28 };

interface SwitchProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	'aria-label'?: string;
	id?: string;
	className?: string;
}

/**
 * An on/off switch: a 28×16 track with a 12px thumb that springs across.
 * Inside a `Field`, the field's label names it.
 */
export function Switch({ checked, onCheckedChange, disabled, 'aria-label': label, id, className }: SwitchProps) {
	const field = useFieldControl({ id });

	return (
		<SwitchPrimitive.Root
			data-ui="switch"
			checked={checked}
			onCheckedChange={onCheckedChange}
			disabled={disabled}
			id={field.id}
			aria-label={label}
			aria-describedby={field.describedBy}
			className={cn(className)}
		>
			<SwitchPrimitive.Thumb asChild>
				<motion.span data-ui="switch-thumb" initial={false} animate={{ x: checked ? TRAVEL : 0 }} transition={TOGGLE} />
			</SwitchPrimitive.Thumb>
		</SwitchPrimitive.Root>
	);
}
