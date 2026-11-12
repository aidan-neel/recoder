'use client';

import { Collapsible, CollapsibleContent } from '@recoder/ui';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { SettingsRow } from '@/components/settings/settings-group';

interface GuidelinesRowProps {
	name: string;
	/** The one line under the name: the layer's first rule, or where it stands. */
	summary?: ReactNode;
	/** In the summary's place: why the file could not be read. */
	failure?: string;
	/** Pills before the button: the branch the file is on, the pull request that waits. */
	status?: ReactNode;
	/** The row's button: Edit, Write or Try again. It steps aside while the editor is open. */
	action: ReactNode;
	/** The editor under the row is open. */
	open: boolean;
	/** The editor that unfolds under the row. */
	children?: ReactNode;
}

/**
 * Puts focus back on the row's button once its editor folds away, unless
 * focus already sits somewhere real (another row's editor). Focus on the
 * page, in the folded editor or in the closing confirm counts as lost.
 */
function useReturnFocus(action: RefObject<HTMLDivElement | null>, open: boolean): void {
	const wasOpen = useRef(open);

	useEffect(() => {
		const closed = wasOpen.current && !open;

		wasOpen.current = open;

		if (!closed) return;

		const frame = requestAnimationFrame(() => {
			const active = document.activeElement;

			if (active && active !== document.body && !active.closest('[inert], [role="alertdialog"]')) return;

			action.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
		});

		return () => cancelAnimationFrame(frame);
	}, [action, open]);
}

/**
 * One layer of guidelines: its name and first rule, its status and its
 * button, with the editor unfolding underneath. Only one row's editor is open
 * at a time.
 */
export function GuidelinesRow({ name, summary, failure, status, action, open, children }: GuidelinesRowProps) {
	const actionSlot = useRef<HTMLDivElement>(null);

	useReturnFocus(actionSlot, open);

	return (
		<div className="guidelines-item">
			<SettingsRow name={name} detail={summary} error={failure}>
				{status}
				<div ref={actionSlot} className="guidelines-action" inert={open}>
					<div className="guidelines-action-clip">{action}</div>
				</div>
			</SettingsRow>
			<Collapsible open={open}>
				<CollapsibleContent>{children}</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
