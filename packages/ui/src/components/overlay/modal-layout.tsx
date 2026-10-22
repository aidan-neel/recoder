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
				'thin-scroll -mx-5 -my-1 flex min-h-0 flex-auto flex-col overflow-y-auto overscroll-contain px-5 py-1',
				className
			)}
			{...props}
		/>
	);
}

/** The actions row: right-aligned, 8px apart, 24px under the body like Sivir's footer under Recoder. */
export function ModalFooter({ className, ...props }: ComponentProps<'div'>) {
	return (
		<div data-ui="modal-footer" className={cn('flex items-center justify-end gap-2 pt-2', className)} {...props} />
	);
}
