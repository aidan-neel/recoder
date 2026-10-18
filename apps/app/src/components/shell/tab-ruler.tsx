'use client';

import { buttonClass } from '@recoder/ui';
import type { Ref } from 'react';

import type { ReviewTab } from '@/lib/shell/shell-store';

import { QueueTabLabel, ReviewTabLabel } from './tab-label';
import { MoreFace } from './tab-overflow';

interface TabRulerProps {
	tabs: ReviewTab[];
	waiting: number | null;
	ref: Ref<HTMLDivElement>;
}

/**
 * Every piece of the tab strip at full size, invisible and out of the flow,
 * so the bar can decide what fits before it paints. It renders the same
 * faces as the strip, without motion.
 */
export function TabRuler({ tabs, waiting, ref }: TabRulerProps) {
	return (
		<div ref={ref} data-ui="top-tabs-ruler" aria-hidden inert>
			<span data-measure="queue" data-ui="top-tab-link">
				<QueueTabLabel waiting={waiting} still />
			</span>
			{tabs.length > 0 ? <span data-measure="separator" data-ui="top-tab-separator" /> : null}
			<span data-measure="more" data-slot="tab-more" className={buttonClass('quiet')}>
				<MoreFace count={tabs.length} still />
			</span>
			{tabs.map((tab) => (
				<span key={tab.id} data-measure-tab={tab.id} data-ui="top-tab-link">
					<ReviewTabLabel tab={tab} still />
				</span>
			))}
		</div>
	);
}
