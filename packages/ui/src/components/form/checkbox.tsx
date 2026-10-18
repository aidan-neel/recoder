'use client';

import { motion, type Transition } from 'motion/react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';
import { DURATION, EASE_IN, EASE_OUT } from '../../motion/presets';
import { useFieldControl } from './field-context';

interface CheckboxProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	id?: string;
	'aria-label'?: string;
	className?: string;
}

/** The check draws in over 180ms when ticked and fades out faster when cleared. */
const DRAW: Transition = { pathLength: { duration: DURATION.toggle, ease: EASE_OUT }, opacity: { duration: 0 } };
const ERASE: Transition = { duration: DURATION.menuOut, ease: EASE_IN };

/**
 * A 16px checkbox. Ticked, the box fills with the primary color and the
 * check draws itself in. Inside a `Field`, the field's label names it.
 */
export function Checkbox({ checked, onCheckedChange, disabled, id, 'aria-label': label, className }: CheckboxProps) {
	const field = useFieldControl({ id });

	return (
		<CheckboxPrimitive.Root
			data-ui="checkbox"
			checked={checked}
			onCheckedChange={(next) => onCheckedChange(next === true)}
			disabled={disabled}
			id={field.id}
			aria-label={label}
			aria-describedby={field.describedBy}
			className={cn(className)}
		>
			<svg data-ui="checkbox-check" viewBox="0 0 24 24" fill="none" aria-hidden>
				<motion.path
					d="M5 12.5 9.5 17 19 7"
					initial={false}
					animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
					transition={checked ? DRAW : ERASE}
				/>
			</svg>
		</CheckboxPrimitive.Root>
	);
}
