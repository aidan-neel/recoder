import type { ComponentProps, ReactNode } from 'react';

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

interface ModalFooterProps extends ComponentProps<'div'> {
	/** Secondary actions held at the left end, such as Back or Check again. */
	start?: ReactNode;
}

/**
 * The actions bar, as in Capy's dialogs: the panel's last row, full width
 * under a hairline, with `start` at the left and the actions at the right,
 * 6px apart.
 */
export function ModalFooter({ start, className, children, ...props }: ModalFooterProps) {
	return (
		<div
			data-ui="modal-footer"
			className={cn(
				'-mx-(--modal-inset) mt-1 -mb-(--modal-inset) flex shrink-0 items-center justify-end gap-1.5 border-t border-line-subtle px-(--modal-inset) py-3',
				className
			)}
			{...props}
		>
			{start ? <div className="mr-auto flex items-center gap-1.5">{start}</div> : null}
			{children}
		</div>
	);
}
