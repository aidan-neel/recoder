'use client';

import { motion } from 'motion/react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { DURATION, EASE_OUT } from '../../motion/presets';

interface RadioOption {
	value: string;
	label: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
}

interface RadioGroupProps {
	value: string;
	onValueChange: (value: string) => void;
	options: RadioOption[];
	'aria-label': string;
	className?: string;
}

/** The dot grows from a quarter of its size as the option is chosen. */
const DOT = { duration: DURATION.toggle, ease: EASE_OUT };

/**
 * One choice from a short list, as stacked option cards. The chosen card's
 * ring lifts and its dot fills in. Arrow keys move the choice, like native
 * radio buttons.
 */
export function RadioGroup({ value, onValueChange, options, 'aria-label': label, className }: RadioGroupProps) {
	const base = useId();

	return (
		<RadioGroupPrimitive.Root
			data-ui="radio-group"
			value={value}
			onValueChange={onValueChange}
			aria-label={label}
			className={cn(className)}
		>
			{options.map((option, index) => {
				const chosen = option.value === value;
				const labelId = `${base}-${index}-label`;
				const descriptionId = option.description ? `${base}-${index}-description` : undefined;

				return (
					<RadioGroupPrimitive.Item
						key={option.value}
						value={option.value}
						disabled={option.disabled}
						aria-labelledby={labelId}
						aria-describedby={descriptionId}
						data-ui="radio-card"
					>
						<span data-ui="radio-dot" aria-hidden>
							<motion.span
								data-ui="radio-dot-fill"
								initial={false}
								animate={{ scale: chosen ? 1 : 0.25, opacity: chosen ? 1 : 0 }}
								transition={DOT}
							/>
						</span>
						<span data-ui="radio-text">
							<span id={labelId} data-ui="radio-label">
								{option.label}
							</span>
							{option.description ? (
								<span id={descriptionId} data-ui="radio-description">
									{option.description}
								</span>
							) : null}
						</span>
					</RadioGroupPrimitive.Item>
				);
			})}
		</RadioGroupPrimitive.Root>
	);
}
