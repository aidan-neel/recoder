'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

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
	/** `md` is 28px tall, like a button; `sm` (24px) fits a dense toolbar. */
	size?: 'sm' | 'md';
	className?: string;
}

/**
 * A small set of mutually exclusive views or filters in one track. The
 * chosen option is filled in place; nothing slides. It behaves as a radio
 * group: one option is always chosen, and arrow keys move the choice.
 */
export function SegmentedControl({
	value,
	onValueChange,
	options,
	'aria-label': label,
	size = 'md',
	className
}: SegmentedControlProps) {
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
					<span data-ui="segmented-label">
						{option.icon}
						{option.label}
					</span>
				</RadioGroupPrimitive.Item>
			))}
		</RadioGroupPrimitive.Root>
	);
}
