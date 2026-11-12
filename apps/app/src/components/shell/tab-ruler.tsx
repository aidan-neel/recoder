'use client';

import { buttonClass } from '@recoder/ui';
import { memo, type Ref } from 'react';

import type { ReviewTab } from '@/lib/shell/shell-store';

import { QueueTabLabel, ReviewTabLabel } from './tab-label';
import { MoreFace } from './tab-overflow';

interface TabRulerProps {
	tabs: ReviewTab[];
	waiting: number | null;
	/** The Queue tab still keeps the boot bar's room for its count. */
	reserve: boolean;
	ref: Ref<HTMLDivElement>;
}

/**
 * A review tab whose names run past the tab's cap, so it measures the widest
 * a tab gets: the room the bar keeps for a review page's tab until it opens.
 * One element for good, so the ruler's renders skip it.
 */
const WIDEST = (
	<span data-measure="widest" data-ui="top-tab-link">
		<ReviewTabLabel
			tab={{ id: '', repo: 'w'.repeat(40), pr: 99999, title: 'w'.repeat(80), open: 99, high: false, seenAt: 0 }}
			still
		/>
	</span>
);

/**
 * One review tab at full size. Memoized on the tab, which the shell store
 * keeps while it does not change, so a new count renders only its own tab.
 */
const RulerTab = memo(function RulerTab({ tab }: { tab: ReviewTab }) {
	return (
		<span data-measure-tab={tab.id} data-ui="top-tab-link">
			<ReviewTabLabel tab={tab} still />
		</span>
	);
});

/**
 * Every piece of the tab strip at full size, invisible and out of the flow,
 * so the bar can decide what fits before it paints. It renders the same
 * faces as the strip, without motion, and only when the tabs or the count
 * change; a decision renders only the Queue count and its own tab.
 */
export const TabRuler = memo(function TabRuler({ tabs, waiting, reserve, ref }: TabRulerProps) {
	return (
		<div ref={ref} data-ui="top-tabs-ruler" aria-hidden inert>
			<span data-measure="queue" data-ui="top-tab-link">
				<QueueTabLabel waiting={waiting} reserve={reserve} still />
			</span>
			<span data-measure="separator" data-ui="top-tab-separator" />
			<span data-measure="more" data-slot="tab-more" className={buttonClass('quiet')}>
				<MoreFace count={tabs.length} still />
			</span>
			{WIDEST}
			{tabs.map((tab) => (
				<RulerTab key={tab.id} tab={tab} />
			))}
		</div>
	);
});
