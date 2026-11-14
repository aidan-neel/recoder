import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/**
 * The modal's content column. It takes the space left between the title and
 * the footer and scrolls on its own, so both stay in view. It reaches into
 * the panel's padding so focus rings at its edges are not clipped.
 */
export function ModalBody({ className, ...props }: ComponentProps<'div'>) {
	return (
		<div
			data-ui="modal-body"
			className={cn(
				'-mx-(--modal-inset) -my-1 flex min-h-0 flex-auto flex-col overflow-y-auto overscroll-contain px-(--modal-inset) py-1',
				className
			)}
			{...props}
		/>
	);
}

/** The actions row: right-aligned, 6px apart, 16px under the body. */
export function ModalFooter({ className, ...props }: ComponentProps<'div'>) {
	return (
		<div data-ui="modal-footer" className={cn('flex items-center justify-end gap-1.5 pt-1', className)} {...props} />
	);
}
