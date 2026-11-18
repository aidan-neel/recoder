'use client';

import { CaretDownIcon } from '@phosphor-icons/react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';

/** The ring a focused half draws inside its own shape, so the other half never covers it. */
const HALF_FOCUS = 'focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_oklab,currentcolor_65%,transparent)]';

/** The hairline between the halves of a filled pair, in the label's own colour. */
const SEAM = [
	'before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-px',
	"before:bg-current before:opacity-20 before:content-['']"
].join(' ');

interface SplitButtonProps extends Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'asChild'> {
	variant?: 'primary' | 'outline';
	/** Names the menu half, which shows only a chevron. */
	menuLabel: string;
	/** The menu's rows: other ways to do the button's action. */
	menu: ReactNode;
	menuClassName?: string;
}

/**
 * A button and a menu of other ways to do its action, read as one control:
 * outer corners round, inner corners square. A filled pair has a hairline of
 * the label's colour between the halves; an outlined pair shares one edge.
 * Each half lights and rings inside its own shape. The button takes the rest
 * of the props; while it is disabled or pending, the menu is shut too.
 */
export function SplitButton({
	variant = 'primary',
	menuLabel,
	menu,
	menuClassName,
	className,
	disabled,
	status,
	...props
}: SplitButtonProps) {
	return (
		<span data-ui="split-button" className="inline-flex shrink-0">
			<Button
				variant={variant}
				status={status}
				disabled={disabled}
				className={cn('rounded-e-none', HALF_FOCUS, className)}
				{...props}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button
						variant={variant}
						size="icon"
						aria-label={menuLabel}
						disabled={disabled || status === 'pending'}
						className={cn('rounded-s-none', HALF_FOCUS, variant === 'primary' ? SEAM : '-ms-px')}
					>
						<CaretDownIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className={menuClassName}>
					{menu}
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	);
}
