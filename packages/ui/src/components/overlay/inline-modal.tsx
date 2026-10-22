'use client';

import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { Panel, Scrim, type ModalSize } from './panel';

interface InlineModalProps {
	size?: ModalSize;
	/** On the panel, as with `ModalContent`. */
	className?: string;
	children: ReactNode;
}

/**
 * A modal drawn inside its nearest positioned parent instead of a portal, for
 * a picture of the app (the site's demo): the same scrim, panel and motion,
 * but no focus trap, scroll lock or Escape. The panel sits 3rem above center
 * like `ModalContent`, never closer than 1rem to the top. `ModalTitle`,
 * `ModalBody` and `ModalFooter` work inside it. Render it in
 * `AnimatePresence` so it leaves with the modal's exit.
 */
export function InlineModal({ size = 'lg', className, children }: InlineModalProps) {
	return (
		<Dialog.Root open>
			<div data-ui="modal-stage">
				<Scrim />
				<Panel size={size} className={className}>
					{children}
				</Panel>
			</div>
		</Dialog.Root>
	);
}
