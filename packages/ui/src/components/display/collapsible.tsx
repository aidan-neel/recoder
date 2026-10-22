'use client';

import { motion, useReducedMotionConfig } from 'motion/react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { createContext, use, useId, useState, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { DURATION } from '../../motion/presets';

/** The disclosure curve: a standard ease that unfolds the body without overshoot. */
const EASE_DISCLOSE = [0.4, 0, 0.2, 1] as const;

interface CollapsibleState {
	open: boolean;
	contentId: string;
}

const CollapsibleContext = createContext<CollapsibleState | null>(null);

/** The open state of the nearest `Collapsible`, for its content. */
function useCollapsible(): CollapsibleState {
	const state = use(CollapsibleContext);

	if (!state) throw new Error('CollapsibleContent must sit inside a Collapsible.');

	return state;
}

type CollapsibleProps = ComponentProps<typeof CollapsiblePrimitive.Root>;

/**
 * A section that opens and closes. Radix owns the trigger's keys, ARIA and
 * `data-state`; the content is the kit's own so it can stay mounted and grow
 * in place while text streams in.
 */
export function Collapsible({ open, defaultOpen = false, onOpenChange, className, ...props }: CollapsibleProps) {
	const [uncontrolled, setUncontrolled] = useState(defaultOpen);
	const contentId = useId();
	const isOpen = open ?? uncontrolled;

	return (
		<CollapsibleContext value={{ open: isOpen, contentId }}>
			<CollapsiblePrimitive.Root
				data-ui="collapsible"
				open={isOpen}
				onOpenChange={(next) => {
					if (open === undefined) setUncontrolled(next);

					onOpenChange?.(next);
				}}
				className={cn(className)}
				{...props}
			/>
		</CollapsibleContext>
	);
}

type CollapsibleTriggerProps = ComponentProps<typeof CollapsiblePrimitive.Trigger>;

/** The button that toggles the section. Pass `asChild` to give the behavior to your own button. */
export function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
	const { contentId } = useCollapsible();

	return (
		<CollapsiblePrimitive.Trigger
			data-ui="collapsible-trigger"
			aria-controls={contentId}
			className={cn(className)}
			{...props}
		/>
	);
}

interface CollapsibleContentProps {
	children: ReactNode;
	className?: string;
}

/**
 * The body. Its height unfolds from 0 to auto (240ms) while it fades in
 * (180ms). It mounts on first open and then stays mounted, so streamed text
 * grows in place and a closed body keeps its state. Reduced motion snaps.
 */
export function CollapsibleContent({ children, className }: CollapsibleContentProps) {
	const { open, contentId } = useCollapsible();
	const reduced = useReducedMotionConfig();
	const [opened, setOpened] = useState(open);

	if (open && !opened) setOpened(true);

	return (
		<motion.div
			id={contentId}
			data-ui="collapsible-content"
			data-state={open ? 'open' : 'closed'}
			inert={!open}
			initial={false}
			animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
			transition={{
				height: { duration: reduced ? 0 : DURATION.disclose, ease: EASE_DISCLOSE },
				opacity: { duration: reduced ? 0 : DURATION.toggle, ease: 'easeOut' }
			}}
			className="overflow-hidden"
		>
			<div data-ui="collapsible-body" className={cn(className)}>
				{opened ? children : null}
			</div>
		</motion.div>
	);
}
