'use client';

import { Icon } from '../icon';
import type { InputHTMLAttributes, KeyboardEvent, MouseEvent, Ref } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';
import { focusInput } from './input';

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
	/** Steps the value by `-1` or `1`; `shift` asks for a coarser step. */
	onStep?: (direction: -1 | 1, shift: boolean) => void;
	/** Whether the decrease button can step further down. */
	canDecrement?: boolean;
	/** Whether the increase button can step further up. */
	canIncrement?: boolean;
	invalid?: boolean;
	/** Classes for the field's frame (width, margins). */
	className?: string;
	/** Classes for the native input inside the frame. */
	inputClassName?: string;
	ref?: Ref<HTMLInputElement>;
}

/** Keeps focus where it already is when a stepper button is pressed with a pointer. */
function keepFocus(event: MouseEvent<HTMLButtonElement>): void {
	event.preventDefault();
}

/** Names a stepper button from the field's own label when it has one. */
function stepLabel(verb: 'Decrease' | 'Increase', fieldLabel: string | undefined): string {
	return fieldLabel ? `${verb} ${fieldLabel}` : verb;
}

/**
 * A compact whole-number field with decrease and increase buttons flanking a
 * centered, tabular input. Arrow keys step the value (Shift steps further)
 * while leaving direct typing, selection and Escape/Enter handling intact.
 */
export function NumberField({
	onStep,
	canDecrement = true,
	canIncrement = true,
	invalid,
	className,
	inputClassName,
	id,
	disabled,
	onKeyDown,
	'aria-label': ariaLabel,
	'aria-describedby': describedBy,
	ref,
	...props
}: NumberFieldProps) {
	const field = useFieldControl({ id, describedBy, invalid });

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (onStep && !event.metaKey && !event.ctrlKey && !event.altKey) {
			if (event.key === 'ArrowUp') {
				event.preventDefault();

				if (canIncrement) onStep(1, event.shiftKey);
			} else if (event.key === 'ArrowDown') {
				event.preventDefault();

				if (canDecrement) onStep(-1, event.shiftKey);
			}
		}

		onKeyDown?.(event);
	}

	return (
		<div
			data-ui="number-field"
			data-invalid={field.invalid ? '' : undefined}
			data-disabled={disabled ? '' : undefined}
			className={cn(className)}
			onMouseDown={focusInput}
		>
			<button
				type="button"
				tabIndex={-1}
				data-ui="number-step"
				aria-label={stepLabel('Decrease', ariaLabel)}
				disabled={disabled || !canDecrement}
				onMouseDown={keepFocus}
				onClick={(event) => onStep?.(-1, event.shiftKey)}
			>
				<Icon name="remove" />
			</button>
			<input
				ref={ref}
				id={field.id}
				type="text"
				inputMode="numeric"
				role="spinbutton"
				disabled={disabled}
				aria-label={ariaLabel}
				aria-describedby={field.describedBy}
				aria-invalid={field.invalid || undefined}
				data-ui="number-input"
				className={cn(inputClassName)}
				onKeyDown={handleKeyDown}
				{...props}
			/>
			<button
				type="button"
				tabIndex={-1}
				data-ui="number-step"
				aria-label={stepLabel('Increase', ariaLabel)}
				disabled={disabled || !canIncrement}
				onMouseDown={keepFocus}
				onClick={(event) => onStep?.(1, event.shiftKey)}
			>
				<Icon name="add" />
			</button>
		</div>
	);
}
