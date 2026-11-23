'use client';

import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';

/** Ticked, clear, or `'some'`: the box that stands for a group in which only some rows are ticked. */
type CheckState = boolean | 'some';

interface CheckboxProps {
	checked: CheckState;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	id?: string;
	'aria-label'?: string;
	className?: string;
}

/** The check, and the dash a box wears when only some of its group is ticked. */
const MARKS = { check: 'M5 12.5 9.5 17 19 7', dash: 'M6 12h12' } as const;

/**
 * A 14px checkbox. Ticked, the box fills with the primary color and the
 * check draws itself in. With `'some'` it fills the same way and draws a
 * dash; a press on it ticks the whole group. Inside a `Field`, the field's
 * label names it.
 */
export function Checkbox({ checked, onCheckedChange, disabled, id, 'aria-label': label, className }: CheckboxProps) {
	const field = useFieldControl({ id });

	return (
		<CheckboxPrimitive.Root
			data-ui="checkbox"
			checked={checked === 'some' ? 'indeterminate' : checked}
			onCheckedChange={(next) => onCheckedChange(next === true)}
			disabled={disabled}
			id={field.id}
			aria-label={label}
			aria-describedby={field.describedBy}
			className={cn(className)}
		>
			<CheckboxMark checked={checked} />
		</CheckboxPrimitive.Root>
	);
}

/**
 * The mark inside a checkbox's box: the check, or the dash for `'some'`. It draws in over 210ms when set and fades out
 * faster when cleared, in CSS (`kit-form-choice.css`), so a list of a few hundred boxes mounts no animation state.
 */
export function CheckboxMark({ checked }: { checked: CheckState }) {
	return (
		<svg data-ui="checkbox-check" data-on={checked ? '' : undefined} viewBox="0 0 24 24" fill="none" aria-hidden>
			<path
				key={checked === 'some' ? 'dash' : 'check'}
				d={checked === 'some' ? MARKS.dash : MARKS.check}
				pathLength={1}
			/>
		</svg>
	);
}
