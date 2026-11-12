'use client';

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

/**
 * The page's groups once the settings and the tracked repositories load, so
 * they land together: a skeleton until then, a notice when the settings do not.
 */
export function AutomationsGroups() {
	const section = useAutoReviewSection();

	if (section.view === 'offline' || section.view === 'error') {
		return <SectionNotice what="Automations" error={section.error} retry={section.retry} />;
	}

	if (section.view === 'loading' || section.reposState === 'loading')
		return <SettingsSkeleton groups={SKELETON_GROUPS} />;

	return (
		<div className="settings">
			<TriggersGroup />
			<WatcherGroup repos={section.repos} />
			<RepositoriesGroup
				repos={section.repos}
				reposState={section.reposState}
				reposError={section.reposError}
				retry={section.retry}
			/>
			<RecentGroup repos={section.repos} />
			<WebhooksGroup />
		</div>
	);
}
