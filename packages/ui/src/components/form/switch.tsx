'use client';

import { motion, type Transition } from 'motion/react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';

/**
 * The switch's geometry in px. The track's CSS stays in px too (the app's
 * px-to-rem step skips `[data-ui='switch']`), so the thumb's travel lines up
 * at every root size.
 */
const TRACK = 32;
const INSET = 3;
const THUMB = 14;
const TRAVEL = TRACK - INSET * 2 - THUMB;

/** A press stretches the thumb this much toward the far side. */
const STRETCH = 4;

/** The toggle springs with a little overshoot; the press stretch is firmer. */
const TOGGLE: Transition = { type: 'spring', stiffness: 560, damping: 28 };
const PRESS: Transition = { type: 'spring', stiffness: 900, damping: 42 };

interface SwitchProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	'aria-label'?: string;
	id?: string;
	className?: string;
}

/**
 * An on/off switch: a 32×20 track with a 14px thumb that springs across.
 * Pressing it (pointer or Space) stretches the thumb, as if it were about to
 * move. Inside a `Field`, the field's label names it.
 */
export function Switch({ checked, onCheckedChange, disabled, 'aria-label': label, id, className }: SwitchProps) {
	const [pressed, setPressed] = useState(false);
	const field = useFieldControl({ id });
	const stretch = pressed && !disabled ? STRETCH : 0;
	const release = () => setPressed(false);

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
			onPointerDown={(event: PointerEvent) => {
				if (event.button === 0) setPressed(true);
			}}
			onPointerUp={release}
			onPointerLeave={release}
			onPointerCancel={release}
			onKeyDown={(event: KeyboardEvent) => {
				if (event.key === ' ' && !event.repeat) setPressed(true);
			}}
			onKeyUp={release}
			onBlur={release}
		>
			<SwitchPrimitive.Thumb asChild>
				<motion.span
					data-ui="switch-thumb"
					initial={false}
					animate={{ x: checked ? TRAVEL : 0, width: THUMB + stretch, marginLeft: checked ? -stretch : 0 }}
					transition={{ x: TOGGLE, width: PRESS, marginLeft: PRESS }}
				/>
			</SwitchPrimitive.Thumb>
		</SwitchPrimitive.Root>
	);
}
