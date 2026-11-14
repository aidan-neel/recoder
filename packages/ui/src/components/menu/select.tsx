'use client';

import { Check, ChevronDown } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { Select as SelectPrimitive } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { buttonClass } from '../button';
import { SwapText } from '../display/swap-text';
import { watchInput } from '../overlay/input-modality';
import { returnFocusQuietly } from '../overlay/return-focus';
import { ShallowBodyLock } from '../overlay/shallow-body-lock';
import { MENU_ITEM, MenuPanel } from './menu-parts';
import { MenuHighlight } from './menu-highlight';

/** One choice in a `Select`. */
export interface SelectOption {
	value: string;
	label: ReactNode;
	/** A second, quieter line under the label. */
	description?: ReactNode;
	disabled?: boolean;
}

interface SelectProps {
	value: string;
	onValueChange: (value: string) => void;
	options: SelectOption[];
	/** Shown while `value` matches no option (an empty string). */
	placeholder?: string;
	variant?: 'quiet' | 'outline';
	size?: 'sm' | 'md';
	/** Which edge of the trigger the list lines up with: `end` for a trigger that ends its row. */
	align?: 'start' | 'end';
	'aria-label'?: string;
	className?: string;
	contentClassName?: string;
	disabled?: boolean;
}

/** One option row: label, optional description, and a check mark on the chosen value. */
function SelectRow({ option }: { option: SelectOption }) {
	return (
		<SelectPrimitive.Item
			value={option.value}
			disabled={option.disabled}
			data-ui="select-item"
			className={cn(MENU_ITEM, option.description && 'h-auto min-h-[26px] items-start py-1')}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<SelectPrimitive.ItemText className="truncate">{option.label}</SelectPrimitive.ItemText>
				{option.description ? <span className="text-[12px] leading-4 text-fg-subtle">{option.description}</span> : null}
			</span>
			<SelectPrimitive.ItemIndicator data-ui="menu-item-check" className={cn(option.description && 'mt-0.5')}>
				<Check aria-hidden />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

/**
 * Picks one value from a short list. The trigger looks like a `Button` of the
 * same variant, and a new choice crossfades into it. The list opens under it
 * on the menu panel, lined up with its start (or its end, with
 * `align="end"`), with the traveling highlight and a check mark on the
 * chosen value. Arrow keys, Home, End and typeahead work; Escape closes and
 * returns focus to the trigger, with its ring only after a key press. A clear layer under the list takes presses
 * outside it, so the page's pointer lock stays shallow (`ShallowBodyLock`).
 */
export function Select({
	value,
	onValueChange,
	options,
	placeholder = 'Select',
	variant = 'outline',
	size = 'md',
	align = 'start',
	'aria-label': ariaLabel,
	className,
	contentClassName,
	disabled
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const selected = options.find((option) => option.value === value);

	useEffect(watchInput, []);

	return (
		<SelectPrimitive.Root
			value={value}
			onValueChange={onValueChange}
			open={open}
			onOpenChange={setOpen}
			disabled={disabled}
		>
			<SelectPrimitive.Trigger
				ref={triggerRef}
				aria-label={ariaLabel}
				data-ui="select-trigger"
				data-variant={variant}
				data-size={size}
				className={buttonClass(variant, size, cn('min-w-0 justify-between gap-2 pr-[7px] text-left', className))}
			>
				<SelectPrimitive.Value
					placeholder={<span className="block truncate text-fg-faint">{placeholder}</span>}
					className="flex min-w-0 flex-1"
				>
					{selected ? (
						<SwapText id={selected.value} className="flex-1">
							{selected.label}
						</SwapText>
					) : undefined}
				</SelectPrimitive.Value>
				<SelectPrimitive.Icon asChild>
					<ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<AnimatePresence>
				{open ? (
					<SelectPrimitive.Portal forceMount>
						<SelectPrimitive.Content
							forceMount
							asChild
							position="popper"
							align={align}
							sideOffset={4}
							collisionPadding={8}
							onCloseAutoFocus={(event) => returnFocusQuietly(event, triggerRef.current)}
						>
							<MenuPanel
								ref={panelRef}
								highlight={false}
								data-ui="select-content"
								className={cn(
									'min-w-[max(160px,var(--radix-select-trigger-width))] overflow-hidden p-0',
									'max-h-(--radix-select-content-available-height)',
									'origin-(--radix-select-content-transform-origin)',
									contentClassName
								)}
							>
								<ShallowBodyLock cover={panelRef} />
								<SelectPrimitive.Viewport data-ui="select-viewport" className="flex flex-col gap-px p-1">
									<MenuHighlight />
									{options.map((option) => (
										<SelectRow key={option.value} option={option} />
									))}
								</SelectPrimitive.Viewport>
							</MenuPanel>
						</SelectPrimitive.Content>
					</SelectPrimitive.Portal>
				) : null}
			</AnimatePresence>
		</SelectPrimitive.Root>
	);
}
