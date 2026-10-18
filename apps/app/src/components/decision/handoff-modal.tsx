'use client';

import { CopyButton, Modal, ModalContent } from '@recoder/ui';

import { useReview } from '@/lib/review/review-store';

import { COPY_PROMPT, HandoffBody } from './handoff-body';

/** Puts focus on Copy prompt when the modal opens, so Enter copies; with nothing to copy, on Close. */
function focusCopy(event: Event): void {
	const panel = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
	const target = panel?.querySelector<HTMLElement>('[data-copy]') ?? panel?.querySelector<HTMLElement>('[data-close]');

	if (!target) return;

	event.preventDefault();
	target.focus();
}

/** The prompt that hands everything sent back to the author agent. */
export function HandoffModal() {
	const open = useReview((store) => store.handoffOpen);

	return (
		<Modal open={open} onOpenChange={(next) => useReview.getState().setHandoffOpen(next)}>
			<ModalContent showClose={false} onOpenAutoFocus={focusCopy}>
				<HandoffBody copy={(prompt) => <CopyButton value={prompt} variant="primary" {...COPY_PROMPT} />} />
			</ModalContent>
		</Modal>
	);
}
