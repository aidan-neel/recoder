'use client';

import { AnimatedNumber, HoverList } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import { memo, type Ref } from 'react';

import { entryHref, type QueueEntry, type QueueSection } from '@/lib/queue/queue';

import { LIST_ITEM_MOTION } from './queue-motion';
import { QueueRow } from './queue-row';

interface QueueListProps {
	sections: QueueSection[];
	sample: boolean;
	/** Where a row leads; null gives it no link. The review or pull request page by default. */
	href?: (entry: QueueEntry) => string | null;
	onOpen: (entry: QueueEntry) => void;
	onStart: (entry: QueueEntry) => void;
	/** Asks before deleting a row's review. */
	onDelete: (entry: QueueEntry) => void;
}

interface QueueHeadProps {
	section: QueueSection;
	first: boolean;
	ref?: Ref<HTMLHeadingElement>;
}

/** A section's title and count. It moves with the rows when a section above appears or empties; the count rolls. */
function QueueHead({ section, first, ref }: QueueHeadProps) {
	return (
		<motion.h2 ref={ref} {...LIST_ITEM_MOTION} className="queue-head" data-first={first || undefined}>
			{section.title}
			<AnimatedNumber value={section.entries.length} className="font-mono text-[11.5px] text-fg-faint" />
		</motion.h2>
	);
}

/**
 * Every section's head and rows as siblings of one list, so a row that
 * changes section keeps its element (and focus) and springs to its new place
 * while the rows around it make room. New rows fade in; closed ones fade out.
 * Each row reads its own progress, pending start and selection, so the list
 * renders again only when its sections change.
 */
export const QueueList = memo(function QueueList({
	sections,
	sample,
	href = (entry) => entryHref(entry, sample),
	onOpen,
	onStart,
	onDelete
}: QueueListProps) {
	return (
		<HoverList className="queue-list" itemSelector="[data-queue-row]" highlightClassName="queue-hover">
			<AnimatePresence initial={false} mode="popLayout">
				{sections.flatMap((section, index) => [
					<QueueHead key={`head:${section.id}`} section={section} first={index === 0} />,
					...section.entries.map((entry) => (
						<QueueRow
							key={`row:${entry.key}`}
							entry={entry}
							section={section.id}
							href={href(entry)}
							sample={sample}
							onOpen={onOpen}
							onStart={onStart}
							onDelete={onDelete}
						/>
					))
				])}
			</AnimatePresence>
		</HoverList>
	);
});
