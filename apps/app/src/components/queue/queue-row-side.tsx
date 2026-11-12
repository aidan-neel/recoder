'use client';

import { Button, Keycap, Pill, SwapText } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';

import { entryAction, entryStatus, type QueueEntry } from '@/lib/queue/queue';
import { pullTitle } from '@/lib/shell/format';

interface QueueRowSideProps {
	entry: QueueEntry;
	starting: boolean;
	/** The row j and k landed on: only its button shows the key, since the keys act on it alone. */
	selected: boolean;
	onOpen: () => void;
	onStart: () => void;
}

/**
 * The row's right edge: the status pill at rest, and the row's one action in
 * its place on hover, focus or selection. A changed label fades out before
 * the new one fades in, so two pills never overlap; a changed tone under the
 * same label only shifts the pill's colors. The swap is CSS, so a queue of
 * rows sets up no animation until a label changes. An Open button does what
 * the row's title does, so Tab skips it and stops once per row; a button
 * that starts a review is a stop of its own. Only that button can be
 * pending, so only it builds the kit's status faces and announcer: a queue of
 * Open rows skips four faces and a live region each.
 */
export function QueueRowSide({ entry, starting, selected, onOpen, onStart }: QueueRowSideProps) {
	const status = entryStatus(entry);
	const action = entryAction(entry);

	return (
		<span className="queue-row-side">
			<span className="queue-row-rest">
				<SwapText id={status?.label ?? ''} mode="wait" className="queue-pill-slot" textClassName="flex">
					{status ? (
						<Pill tone={status.tone} className="queue-pill">
							{status.label}
						</Pill>
					) : null}
				</SwapText>
				<ChevronRight size={16} strokeWidth={1.75} className="text-fg-ghost" aria-hidden />
			</span>
			<span className="queue-row-actions">
				<Button
					variant={action.starts ? 'primary' : 'outline'}
					className="queue-row-btn"
					status={action.starts ? (starting ? 'pending' : 'idle') : undefined}
					pendingLabel="Starting"
					aria-label={`${action.label}, ${pullTitle(entry.pull.title, entry.pull.number)}`}
					aria-keyshortcuts={selected ? (action.starts ? 'R' : 'Enter') : undefined}
					tabIndex={action.starts ? undefined : -1}
					onClick={action.starts ? onStart : onOpen}
				>
					{action.label}
					{selected ? <Keycap k={action.starts ? 'r' : 'Enter'} /> : null}
				</Button>
			</span>
		</span>
	);
}
