'use client';

import { SwapText } from '@recoder/ui';

import { Brief } from '@/components/common/brief';
import { queueHeadline, type Unloaded } from '@/lib/queue/headline';
import type { QueueSection } from '@/lib/queue/queue';

interface QueueHeadlineProps {
	sections: QueueSection[];
	/** Which repositories' pull requests did not load, so an empty list is not said to be empty. */
	unloaded?: Unloaded;
}

/**
 * The serif headline over the queue. When the sentence changes, the old one
 * fades out before the new one fades in, so two sentences never overlap in
 * one place, whichever of them wraps.
 */
export function QueueHeadline({ sections, unloaded = null }: QueueHeadlineProps) {
	const { lead, rest } = queueHeadline(sections, unloaded);

	return (
		<div className="queue-brief">
			<SwapText id={`${lead} ${rest}`} mode="wait">
				<Brief as="h1" lead={lead} rest={rest || undefined} />
			</SwapText>
		</div>
	);
}
