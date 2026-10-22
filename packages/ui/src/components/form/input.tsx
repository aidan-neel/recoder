'use client';

import type { InputHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
	/** Sits inside the field before the text: a 15px icon or a short prefix. */
	leading?: ReactNode;
	/** Sits inside the field after the text: a keycap, a clear button, a unit. */
	trailing?: ReactNode;
	/** `md` is 30px tall, `lg` 40px (a page's main filter). */
	size?: 'md' | 'lg';
	invalid?: boolean;
	/** Classes for the field's frame (width, margins). */
	className?: string;
	/** Classes for the native input inside the frame. */
	inputClassName?: string;
	ref?: Ref<HTMLInputElement>;
}

/** Elements inside the frame that take their own clicks, so a press on them must not move focus to the input. */
const OWN_CLICKS = 'input, button, a, select, textarea, [tabindex]';

/** A press on the frame or an icon focuses the input, as if the frame were the field. */
function focusInput(event: MouseEvent<HTMLDivElement>) {
	const target = event.target as Element;

	if (target.closest(OWN_CLICKS)) return;

	event.preventDefault();
	event.currentTarget.querySelector('input')?.focus();
}

/**
 * A text field. The ring and fill live on the frame, so icons, keycaps and
 * buttons can sit inside it; the native input stays bare. Focus lifts the ring
 * and adds a soft halo; `invalid` (or an error on the enclosing `Field`) turns
 * the ring red.
 */
export function Input({
	leading,
	trailing,
	size = 'md',
	invalid,
	className,
	inputClassName,
	id,
	disabled,
	'aria-describedby': describedBy,
	ref,
	...props
}: InputProps) {
	const field = useFieldControl({ id, describedBy, invalid });

	return (
		<div
			data-ui="input"
			data-size={size}
			data-invalid={field.invalid ? '' : undefined}
			data-disabled={disabled ? '' : undefined}
			className={cn(className)}
			onMouseDown={focusInput}
		>
			{leading ? <span data-ui="input-leading">{leading}</span> : null}
			<input
				ref={ref}
				id={field.id}
				disabled={disabled}
				aria-describedby={field.describedBy}
				aria-invalid={field.invalid || undefined}
				data-ui="input-field"
				className={cn(inputClassName)}
				{...props}
			/>
			{trailing ? <span data-ui="input-trailing">{trailing}</span> : null}
		</div>
	);
}
