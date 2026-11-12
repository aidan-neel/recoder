'use client';

import { useConnections } from '@/lib/connections/connections-store';
import { useAutoReviewSection } from '@/lib/settings/use-auto-review-section';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { RecentGroup } from './recent-group';
import { RepositoriesGroup } from './repositories-group';
import { TriggersGroup } from './triggers-group';
import { WatcherGroup } from './watcher-group';
import { WebhooksGroup } from './webhooks-group';

/** The groups' row counts while they load: Triggers, Watcher, Repositories, Recent, Webhooks. */
const SKELETON_GROUPS = [6, 3, 2, 1, 2];

/** True until the first load of the tracked repositories answers, so the groups land together. */
function useReposPending(): boolean {
	return useConnections((state) => state.reposStatus === 'idle' || state.reposStatus === 'loading');
}

/** The page's groups once the settings load: a skeleton until then, a notice when they do not. */
export function AutomationsGroups() {
	const section = useAutoReviewSection();
	const reposPending = useReposPending();

	if (section.view === 'offline' || section.view === 'error') {
		return <SectionNotice what="Automations" error={section.error} retry={section.retry} />;
	}

	if (section.view === 'loading' || reposPending) return <SettingsSkeleton groups={SKELETON_GROUPS} />;

	return (
		<div className="settings">
			<TriggersGroup />
			<WatcherGroup repos={section.repos} />
			<RepositoriesGroup repos={section.repos} retry={section.retry} />
			<RecentGroup repos={section.repos} />
			<WebhooksGroup />
		</div>
	);
}
