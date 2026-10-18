'use client';

import { ScrollArea } from '@recoder/ui';
import { useMemo } from 'react';

import { QueueHeadline } from '@/components/queue/queue-headline';
import { QueueList } from '@/components/queue/queue-list';
import { queueSections } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';

/** Rows lead nowhere in the demo: the window never opens a link or starts a review. */
function stay(): void {}

/** No row gets a link, so nothing in the window prefetches a page the site does not have. */
function noHref(): null {
	return null;
}

/** The sample queue from the queue store, as the app's queue page lays it out: the headline, then the app's `QueueList`. */
export function DemoQueue() {
	const entries = useQueue((state) => state.entries);
	const sections = useMemo(() => queueSections(entries), [entries]);

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="queue-column">
				<QueueHeadline sections={sections} />
				<QueueList sections={sections} sample href={noHref} onOpen={stay} onStart={stay} onDelete={stay} />
			</div>
		</ScrollArea>
	);
}
