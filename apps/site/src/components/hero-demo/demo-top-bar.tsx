'use client';

import { NavPillGroup } from '@recoder/ui';
import { AnimatePresence } from 'motion/react';

import { Grow } from '@/components/shell/grow';
import { SearchButton } from '@/components/shell/search-button';
import { SettingsButton } from '@/components/shell/settings-button';
import { QueueTabLabel, ReviewTabLabel } from '@/components/shell/tab-label';
import { TopTab } from '@/components/shell/top-tab';
import { SAMPLE_REVIEW } from '@/lib/sample/sample-review';
import { QUEUE_TAB } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

/**
 * The window's top bar, from the app's tabs, search field and settings gear
 * and the shell store's tabs: Queue with the pull requests that need you,
 * then the sample review's tab once it opens, which grows in while the pill
 * slides over to it. No tab or button leads anywhere: the window never
 * navigates.
 */
export function DemoTopBar({ reviewOpen }: { reviewOpen: boolean }) {
	const tab = useShell((state) => state.tabs.find((item) => item.id === SAMPLE_REVIEW.id) ?? null);
	const waiting = useShell((state) => state.waiting.sample);
	const active = reviewOpen && tab ? tab.id : QUEUE_TAB;

	return (
		<>
			<div className="flex h-full min-w-0 flex-1 items-center gap-1.5">
				<div className="relative flex h-full min-w-0 flex-1 items-center">
					<div data-ui="top-tabs">
						<NavPillGroup>
							<TopTab id={QUEUE_TAB} active={active === QUEUE_TAB}>
								<QueueTabLabel waiting={waiting} />
							</TopTab>
							<AnimatePresence initial={false}>
								{tab ? (
									<Grow key="separator">
										<span data-ui="top-tab-separator" />
									</Grow>
								) : null}
								{tab ? (
									<Grow key={tab.id} lead={active === tab.id}>
										<TopTab id={tab.id} active={active === tab.id}>
											<ReviewTabLabel tab={tab} />
										</TopTab>
									</Grow>
								) : null}
							</AnimatePresence>
						</NavPillGroup>
					</div>
				</div>
				<SearchButton />
			</div>
			<SettingsButton />
		</>
	);
}
