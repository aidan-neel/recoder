'use client';

import { X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { Dialog } from 'radix-ui';
import { createContext, useContext, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button';
import { Layer, Panel, Scrim, TITLE_CLASS, type ModalSize } from './panel';
import { useReturnFocus } from './return-focus';
import { useOpenState, type OpenProps } from './use-open-state';

/** Whether the nearest modal is open, so its content stays mounted until the exit animation ends. */
const ModalOpen = createContext(false);

/**
 * A modal dialog. Pass `open` and `onOpenChange` to control it, or
 * `defaultOpen` to let it keep its own state. Radix traps focus, locks
 * scroll, hides the page from assistive tech and closes the top layer first
 * on Escape, so a popover inside a modal closes before the modal does.
 */
export function Modal({ children, ...state }: OpenProps) {
	const [open, setOpen] = useOpenState(state);

	return (
		<ModalOpen value={open}>
			<Dialog.Root open={open} onOpenChange={setOpen}>
				{children}
			</Dialog.Root>
		</ModalOpen>
	);
}

/** Closes the modal when its child is pressed. */
export function ModalClose({ children }: { children: ReactElement }) {
	return <Dialog.Close asChild>{children}</Dialog.Close>;
}

/**
 * Toasts sit above an open modal; pressing one (an Undo, say) must neither
 * dismiss the modal nor be swallowed by it.
 */
function keepToasts(event: Event) {
	if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) event.preventDefault();
}

interface ModalContentProps {
	size?: ModalSize;
	/** Show the X in the top right corner. */
	showClose?: boolean;
	className?: string;
	children?: ReactNode;
	/** Names a modal that has no `ModalTitle`. */
	'aria-label'?: string;
	/** Runs when the modal opens and moves focus to its first control; prevent it to place focus yourself. */
	onOpenAutoFocus?: (event: Event) => void;
	/** Runs when the modal closes and returns focus to what had it before; prevent it to place focus yourself. */
	onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The modal panel and its scrim. The panel scales in from 0.95 through a 2px
 * blur and a 3px rise (150ms) and leaves in 70ms; the scrim only fades.
 * Under reduced motion the panel only fades too. On close, focus returns to
 * what had it when the modal opened.
 */
export function ModalContent({
	size = 'lg',
	showClose = true,
	className,
	children,
	'aria-label': label,
	onOpenAutoFocus,
	onCloseAutoFocus
}: ModalContentProps) {
	const open = useContext(ModalOpen);
	const { panelRef, restoreFocus } = useReturnFocus<HTMLDivElement>(open, onCloseAutoFocus);

	return (
		<AnimatePresence>
			{open ? (
				<Dialog.Portal forceMount>
					<Layer>
						<Dialog.Overlay forceMount asChild>
							<Scrim />
						</Dialog.Overlay>
						<Dialog.Content
							forceMount
							asChild
							aria-label={label}
							onOpenAutoFocus={onOpenAutoFocus}
							onCloseAutoFocus={restoreFocus}
							onPointerDownOutside={keepToasts}
							onInteractOutside={keepToasts}
						>
							<Panel ref={panelRef} size={size} data-close={showClose || undefined} className={className}>
								{children}
								{showClose ? <CloseButton /> : null}
							</Panel>
						</Dialog.Content>
					</Layer>
				</Dialog.Portal>
			) : null}
		</AnimatePresence>
	);
}

/** The X, quiet until hovered. It comes last in the DOM so the first control in the body takes focus on open. */
function CloseButton() {
	return (
		<Dialog.Close asChild>
			<Button
				variant="quiet"
				size="icon"
				aria-label="Close"
				data-slot="close"
				className="absolute top-3.5 right-3.5 text-fg-subtle hover:text-fg"
			>
				<X />
			</Button>
		</Dialog.Close>
	);
}

/** The modal's title; it names the dialog for assistive tech. */
export function ModalTitle({ className, ...props }: ComponentProps<'h2'>) {
	return <Dialog.Title data-ui="modal-title" className={cn(TITLE_CLASS, className)} {...props} />;
}
