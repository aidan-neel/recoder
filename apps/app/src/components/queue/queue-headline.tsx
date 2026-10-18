'use client';

import { swapMotion, useMotionVariants } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';

import { Brief } from '@/components/common/brief';
import { queueHeadline } from '@/lib/queue/headline';
import type { QueueSection } from '@/lib/queue/queue';

/** The serif headline over the queue. When the sentence changes it crossfades in place. */
export function QueueHeadline({ sections }: { sections: QueueSection[] }) {
	const swap = useMotionVariants(swapMotion);
	const { lead, rest } = queueHeadline(sections);

	return (
		<div className="queue-brief">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.div key={`${lead} ${rest}`} variants={swap} initial="initial" animate="animate" exit="exit">
					<Brief as="h1" lead={lead} rest={rest || undefined} />
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
