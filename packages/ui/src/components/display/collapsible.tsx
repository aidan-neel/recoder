'use client';

import { motion, useReducedMotionConfig, type Transition } from 'motion/react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { createContext, use, useId, useState, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { DURATION, EASE_OUT } from '../../motion/presets';

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
	/**
	 * How the body opens and closes, in place of the kit's quiet unfold. It
	 * may time `height` and `opacity` apart and stagger the children that
	 * follow the body's `expanded` and `collapsed` variants. Reduced motion
	 * still snaps.
	 */
	transition?: Transition;
}

/** The kit's unfold: the height over 230ms on the kit's ease-out while the body fades in over 210ms. */
const UNFOLD: Transition = {
	height: { duration: DURATION.disclose, ease: EASE_OUT },
	opacity: { duration: DURATION.toggle, ease: EASE_OUT }
};

const SNAP: Transition = { duration: 0 };

/**
 * The body. Its height unfolds from 0 to auto while it fades in, as the
 * `expanded` variant; closing plays `collapsed`. Motion children with
 * variants of those names follow it, so a caller can bring rows in one
 * after another. A body that mounts open shows its children in place;
 * one that mounts closed brings them in on its first open. It mounts its
 * children on first open and then keeps them, so streamed text grows in
 * place and a closed body keeps its state. Reduced motion snaps.
 */
export function CollapsibleContent({ children, className, transition = UNFOLD }: CollapsibleContentProps) {
	const { open, contentId } = useCollapsible();
	const reduced = useReducedMotionConfig();
	const [opened, setOpened] = useState(open);
	const [initial] = useState(open ? false : 'collapsed');

	if (open && !opened) setOpened(true);

	return (
		<motion.div
			id={contentId}
			data-ui="collapsible-content"
			data-state={open ? 'open' : 'closed'}
			inert={!open}
			initial={initial}
			animate={open ? 'expanded' : 'collapsed'}
			variants={{ expanded: { height: 'auto', opacity: 1 }, collapsed: { height: 0, opacity: 0 } }}
			transition={reduced ? SNAP : transition}
			className="overflow-hidden"
		>
			<div data-ui="collapsible-body" className={cn(className)}>
				{opened ? children : null}
			</div>
		</motion.div>
	);
}
