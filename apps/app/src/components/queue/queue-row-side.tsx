'use client';

import { Button, Keycap, Pill, swapMotion, useMotionVariants } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

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
 * its place on hover, focus or selection. A changed label crossfades.
 */
export function QueueRowSide({ entry, starting, selected, onOpen, onStart }: QueueRowSideProps) {
	const swap = useMotionVariants(swapMotion);
	const status = entryStatus(entry);
	const action = entryAction(entry);

	return (
		<span className="queue-row-side">
			<span className="queue-row-rest">
				<span className="queue-pill-slot">
					<AnimatePresence initial={false} mode="popLayout">
						{status ? (
							<motion.span
								key={status.label}
								className="flex"
								variants={swap}
								initial="initial"
								animate="animate"
								exit="exit"
							>
								<Pill tone={status.tone} className="queue-pill">
									{status.label}
								</Pill>
							</motion.span>
						) : null}
					</AnimatePresence>
				</span>
				<ChevronRight size={16} strokeWidth={1.75} className="text-fg-ghost" aria-hidden />
			</span>
			<span className="queue-row-actions">
				<Button
					variant={action.starts ? 'primary' : 'outline'}
					className="queue-row-btn"
					status={starting ? 'pending' : 'idle'}
					pendingLabel="Starting"
					aria-label={`${action.label}, ${pullTitle(entry.pull.title, entry.pull.number)}`}
					aria-keyshortcuts={selected ? (action.starts ? 'R' : 'Enter') : undefined}
					onClick={action.starts ? onStart : onOpen}
				>
					{action.label}
					{selected ? <Keycap k={action.starts ? 'r' : 'Enter'} /> : null}
				</Button>
			</span>
		</span>
	);
}
