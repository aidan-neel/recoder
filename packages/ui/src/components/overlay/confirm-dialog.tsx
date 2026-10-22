'use client';

import { AnimatePresence } from 'motion/react';
import { AlertDialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { Button, type ButtonStatus } from '../button';
import { ModalFooter } from './modal-layout';
import { DESCRIPTION_CLASS, Layer, Panel, Scrim, TITLE_CLASS } from './panel';
import { useReturnFocus, type ReturnFocus } from './return-focus';

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description?: ReactNode;
	confirmLabel: ReactNode;
	cancelLabel?: ReactNode;
	/** Paint the confirm button in the danger tint, for actions that delete or discard. */
	destructive?: boolean;
	size?: 'sm' | 'md';
	/** The action. A returned promise holds the button in pending; a rejection keeps the dialog open on its error face. */
	onConfirm: () => void | Promise<void>;
}

type PanelProps = Omit<ConfirmDialogProps, 'open'> & ReturnFocus<HTMLDivElement>;

/**
 * Asks before an action runs. Focus starts on Cancel. The confirm button
 * shows a spinner while `onConfirm` runs, closes the dialog when it
 * resolves, and turns to "Try again" when it rejects, with the error's
 * message under the description. A click outside never closes it, and
 * neither Escape nor Cancel does while the action runs. On close, focus
 * returns to what had it when the dialog opened.
 */
export function ConfirmDialog({ open, ...panel }: ConfirmDialogProps) {
	const { panelRef, restoreFocus } = useReturnFocus<HTMLDivElement>(open);

	return (
		<AlertDialog.Root open={open} onOpenChange={panel.onOpenChange}>
			<AnimatePresence>
				{open ? <ConfirmPanel key="confirm" {...panel} panelRef={panelRef} restoreFocus={restoreFocus} /> : null}
			</AnimatePresence>
		</AlertDialog.Root>
	);
}

/** Mounted once per opening, so every opening starts with an idle confirm button. */
function ConfirmPanel({
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel = 'Cancel',
	destructive = false,
	size = 'sm',
	onConfirm,
	panelRef,
	restoreFocus
}: PanelProps) {
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [failure, setFailure] = useState<string | null>(null);
	const pending = status === 'pending';

	async function confirm() {
		setStatus('pending');
		setFailure(null);

		try {
			await onConfirm();
		} catch (error) {
			setStatus('error');
			setFailure(error instanceof Error && error.message ? error.message : null);

			return;
		}

		onOpenChange(false);
	}

	return (
		<AlertDialog.Portal forceMount>
			<Layer>
				<AlertDialog.Overlay forceMount asChild>
					<Scrim />
				</AlertDialog.Overlay>
				<AlertDialog.Content
					forceMount
					asChild
					onCloseAutoFocus={restoreFocus}
					onEscapeKeyDown={(event) => {
						if (pending) event.preventDefault();
					}}
				>
					<Panel ref={panelRef} size={size} data-tone={destructive ? 'destructive' : undefined}>
						<AlertDialog.Title data-ui="modal-title" className={TITLE_CLASS}>
							{title}
						</AlertDialog.Title>
						{description ? (
							<AlertDialog.Description data-ui="modal-description" className={DESCRIPTION_CLASS}>
								{description}
							</AlertDialog.Description>
						) : null}
						{failure ? (
							<p
								role="alert"
								data-ui="confirm-error"
								className="-mt-2 text-[length:var(--font-size-label)] leading-normal text-pretty text-danger"
							>
								{failure}
							</p>
						) : null}
						<ModalFooter>
							<AlertDialog.Cancel asChild>
								<Button variant="ghost" disabled={pending}>
									{cancelLabel}
								</Button>
							</AlertDialog.Cancel>
							<Button variant={destructive ? 'destructive' : 'primary'} status={status} onClick={confirm}>
								{confirmLabel}
							</Button>
						</ModalFooter>
					</Panel>
				</AlertDialog.Content>
			</Layer>
		</AlertDialog.Portal>
	);
}
