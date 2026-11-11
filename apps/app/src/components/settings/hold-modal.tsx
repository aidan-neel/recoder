'use client';

import { Modal, ModalContent } from '@recoder/ui';
import { useState, type ReactNode } from 'react';

interface HoldModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The content; it tells the modal when a request is with the server, so the modal can hold still until it answers. */
	children: (onSending: (sending: boolean) => void) => ReactNode;
}

/**
 * The modal a connect form lives in. While a key or address is with the
 * server it stays open (Escape and a click outside wait for the answer), so
 * it has no X that would look live but do nothing; the form's Cancel closes it.
 */
export function HoldModal({ open, onOpenChange, children }: HoldModalProps) {
	const [sending, setSending] = useState(false);

	return (
		<Modal
			open={open}
			onOpenChange={(next) => {
				if (next || !sending) onOpenChange(next);
			}}
		>
			<ModalContent size="md" showClose={false} className="provider-modal">
				{children(setSending)}
			</ModalContent>
		</Modal>
	);
}
