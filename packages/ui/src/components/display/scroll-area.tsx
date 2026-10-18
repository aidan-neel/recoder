'use client';

import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react';

import { cn } from '../../lib/cn';

/** How long the bars stay up after the last scroll, matching Radix's hide delay. */
const SCROLL_LINGER_MS = 600;

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
 * Marks the root with `data-scrolling` while its viewport scrolls, so the bars
 * fade in for keyboard and wheel scrolls as well as on hover. It writes the
 * attribute directly to avoid a render per scroll event.
 */
function useScrollingFlag(root: RefObject<HTMLDivElement | null>) {
	useEffect(() => {
		const element = root.current;
		const viewport = element?.querySelector<HTMLElement>('[data-ui="scroll-area-viewport"]');

		if (!element || !viewport) return;

		let timer = 0;

		function onScroll() {
			element?.setAttribute('data-scrolling', '');
			window.clearTimeout(timer);
			timer = window.setTimeout(() => element?.removeAttribute('data-scrolling'), SCROLL_LINGER_MS);
		}

		viewport.addEventListener('scroll', onScroll, { passive: true });

		return () => {
			window.clearTimeout(timer);
			viewport.removeEventListener('scroll', onScroll);
		};
	}, [root]);
}

/** One thin bar along an axis. Its thumb renders only while the content overflows that axis; CSS hides an empty bar. */
function Bar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
	return (
		<ScrollAreaPrimitive.Scrollbar data-ui="scroll-area-scrollbar" orientation={orientation}>
			<ScrollAreaPrimitive.Thumb data-ui="scroll-area-thumb" />
		</ScrollAreaPrimitive.Scrollbar>
	);
}

/**
 * A scrolling region with a thin, quiet bar: a 6px `--line-strong` thumb that
 * fades in on hover or while scrolling. It never shows edge cues or a blur.
 * A vertical area lays its content out at the viewport's width, so long text
 * wraps or truncates instead of scrolling sideways.
 */
export function ScrollArea({
	className,
	viewportClassName,
	viewportRef,
	viewportProps,
	children,
	orientation = 'vertical'
}: ScrollAreaProps) {
	const root = useRef<HTMLDivElement>(null);
	const vertical = orientation !== 'horizontal';
	const horizontal = orientation !== 'vertical';

	useScrollingFlag(root);

	return (
		<ScrollAreaPrimitive.Root
			ref={root}
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
