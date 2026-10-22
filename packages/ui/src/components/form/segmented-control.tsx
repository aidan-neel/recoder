'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Pill } from './pill';

interface SegmentOption {
	value: string;
	label: ReactNode;
	icon?: ReactNode;
}

interface SegmentedControlProps {
	value: string;
	onValueChange: (value: string) => void;
	options: SegmentOption[];
	'aria-label': string;
	/** `md` is 30px tall; `sm` (26px) fits a dense toolbar. */
	size?: 'sm' | 'md';
	className?: string;
}

/**
 * A small set of mutually exclusive views or filters in one track. A raised
 * pill slides to the chosen option. It behaves as a radio group: one option
 * is always chosen, and arrow keys move the choice.
 */
export function SegmentedControl({
	value,
	onValueChange,
	options,
	'aria-label': label,
	size = 'md',
	className
}: SegmentedControlProps) {
	const pill = `${useId()}-pill`;

	return (
		<RadioGroupPrimitive.Root
			data-ui="segmented"
			data-size={size}
			value={value}
			onValueChange={onValueChange}
			orientation="horizontal"
			aria-label={label}
			className={cn(className)}
		>
			{options.map((option) => (
				<RadioGroupPrimitive.Item key={option.value} value={option.value} data-ui="segmented-item">
					{option.value === value ? <Pill layoutId={pill} ui="segmented-pill" radius={7} value={value} /> : null}
					<span data-ui="segmented-label">
						{option.icon}
						{option.label}
					</span>
				</RadioGroupPrimitive.Item>
			))}
		</RadioGroupPrimitive.Root>
	);
}
