'use client';

import { Collapsible, CollapsibleContent, SPRING, swapMotion, useMotionVariants } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { SettingsRow } from '@/components/settings/settings-group';

interface GuidelinesRowProps {
	name: string;
	/** The one-line preview under the name. A new line crossfades in; a skeleton giving way does not, since the loading row is its own instance. */
	summary: ReactNode;
	/** Paints the summary in the danger tone, for a file that could not be read. */
	failed?: boolean;
	/** Status pills before the action ("Active · main", "Pending in #12"). */
	status?: ReactNode;
	/** The Write or Edit button. It steps aside while the editor is open. */
	action?: ReactNode;
	open: boolean;
	/** The editor that unfolds under the row. */
	children?: ReactNode;
}

/**
 * Puts focus back on the row's button once its editor folds away, unless
 * focus already moved somewhere real (another row's editor). Focus left on
 * the page, in the folded editor or in the closing confirm counts as lost.
 */
function useReturnFocus(row: RefObject<HTMLDivElement | null>, open: boolean) {
	const wasOpen = useRef(open);

	useEffect(() => {
		const closed = wasOpen.current && !open;

		wasOpen.current = open;

		if (!closed) return;

		const frame = requestAnimationFrame(() => {
			const active = document.activeElement;

			if (active && active !== document.body && !active.closest('[inert], [role="alertdialog"]')) return;

			row.current?.querySelector<HTMLElement>('[data-slot="row-action"] button, [data-slot="row-action"] a')?.focus();
		});

		return () => cancelAnimationFrame(frame);
	}, [row, open]);
}

/**
 * One layer of guidelines: its name and first rule, its status and its
 * button, with the editor folding open underneath (height 240ms). Only one
 * row's editor is open at a time.
 */
export function GuidelinesRow({ name, summary, failed, status, action, open, children }: GuidelinesRowProps) {
	const swap = useMotionVariants(swapMotion);
	const row = useRef<HTMLDivElement>(null);

	useReturnFocus(row, open);

	return (
		<div
			ref={row}
			data-ui="guidelines-row"
			data-open={open || undefined}
			data-failed={failed || undefined}
			className="guidelines-item"
		>
			<SettingsRow name={name} description={summary}>
				{status ? (
					<motion.div layout="position" transition={SPRING} className="flex shrink-0">
						{status}
					</motion.div>
				) : null}
				<AnimatePresence initial={false} mode="popLayout">
					{open || !action ? null : (
						<motion.div
							key="action"
							data-slot="row-action"
							variants={swap}
							initial="initial"
							animate="animate"
							exit="exit"
						>
							{action}
						</motion.div>
					)}
				</AnimatePresence>
			</SettingsRow>
			<Collapsible open={open}>
				<CollapsibleContent>{children}</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
