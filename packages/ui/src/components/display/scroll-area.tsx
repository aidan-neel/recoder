'use client';

import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { HTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '../../lib/cn';

/** Attributes for the scrolling element itself: a tab stop, a role and a name, the app's data hooks. */
type ViewportProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'> & {
	[key: `data-${string}`]: string | undefined;
};

interface ScrollAreaProps {
	className?: string;
	viewportClassName?: string;
	/** The scrolling element, for code that reads or sets its scroll position. */
	viewportRef?: Ref<HTMLDivElement>;
	/** Spread onto the scrolling element (`tabIndex`, `role`, `aria-label`, `data-*`), so a pane can be a keyboard stop. */
	viewportProps?: ViewportProps;
	children: ReactNode;
	orientation?: 'vertical' | 'horizontal' | 'both';
}

/**
 * The axis's bar, kept mounted because Radix lets the viewport scroll only on an axis with one; CSS hides it.
 */
function Bar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
	return <ScrollAreaPrimitive.Scrollbar data-ui="scroll-area-scrollbar" orientation={orientation} />;
}

/**
 * A scrolling region with no visible bar, edge cues or blur; it scrolls by
 * wheel, touch and keys. A vertical area lays its content out at the
 * viewport's width, so long text wraps or truncates instead of scrolling
 * sideways.
 */
export function ScrollArea({
	className,
	viewportClassName,
	viewportRef,
	viewportProps,
	children,
	orientation = 'vertical'
}: ScrollAreaProps) {
	const vertical = orientation !== 'horizontal';
	const horizontal = orientation !== 'vertical';

	return (
		<ScrollAreaPrimitive.Root
			type="always"
			data-ui="scroll-area"
			data-orientation={orientation}
			className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
		>
			<ScrollAreaPrimitive.Viewport
				{...viewportProps}
				ref={viewportRef}
				data-ui="scroll-area-viewport"
				disableImplicitContentElement
				className={cn('max-h-[inherit] min-h-0 w-full flex-1 overscroll-contain', viewportClassName)}
			>
				<ScrollAreaPrimitive.Content
					data-ui="scroll-area-content"
					style={horizontal ? undefined : { display: 'block', minWidth: 0 }}
				>
					{children}
				</ScrollAreaPrimitive.Content>
			</ScrollAreaPrimitive.Viewport>
			{vertical && <Bar orientation="vertical" />}
			{horizontal && <Bar orientation="horizontal" />}
		</ScrollAreaPrimitive.Root>
	);
}
