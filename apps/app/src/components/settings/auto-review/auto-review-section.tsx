'use client';

import { Button } from '@recoder/ui';
import { useEffect } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';
import { whileVisible } from '@/lib/review/while-visible';
import { useAutoReview } from '@/lib/settings/auto-review-store';
import { useAction } from '@/lib/shell/use-action';

import { SettingsSkeleton } from '../settings-skeleton';
import { RecentGroup, WebhookGroup } from './activity-groups';
import { ReposGroup } from './repos-group';
import { TriggerGroups } from './trigger-groups';
import { WatcherGroup } from './watcher-group';

/** The groups' row counts while they load: Watcher, Start a review when, On the pull request, Repositories. */
const SKELETON_GROUPS = [3, 5, 1, 2];

/** How often the watcher's state is read again while the section is open, for the last check and new reviews. */
const REFRESH_MS = 15_000;

/** Loads the settings and the tracked repositories, which the repository switches and the recent reviews name. */
function load(): Promise<unknown> {
	return Promise.all([useAutoReview.getState().load(), useConnections.getState().loadRepos()]);
}

/** The section when its settings did not load: the server is down, or answered with an error. */
function Unavailable({ lead, rest }: { lead: string; rest: string }) {
	const retry = useAction();

	return (
		<PageNotice heading="h2" lead={lead} rest={rest}>
			<Button status={retry.status} onClick={() => retry.run(load)}>
				Try again
			</Button>
		</PageNotice>
	);
}

/**
 * Settings → Auto-review: the watcher that starts reviews on its own when
 * someone mentions Recoder, a pull request opens or new commits land, what it
 * says on the pull request, which repositories it checks, and what it started.
 */
export function AutoReviewSection() {
	const status = useAutoReview((state) => state.status);
	const loaded = useAutoReview((state) => state.payload !== null);
	const error = useAutoReview((state) => state.error);
	const repos = useConnections((state) => state.repos) ?? [];

	useEffect(() => {
		void load();

		return whileVisible(REFRESH_MS, () => void useAutoReview.getState().load());
	}, []);

	if (status === 'offline') return <Unavailable lead={OFFLINE_TEXT} rest="Start it, then try again." />;

	if (status === 'error')
		return <Unavailable lead="Auto-review settings didn’t load." rest={error ?? 'Try again in a moment.'} />;

	if (!loaded) return <SettingsSkeleton groups={SKELETON_GROUPS} />;

	return (
		<div className="settings-stack">
			<WatcherGroup repos={repos} />
			<TriggerGroups />
			<ReposGroup repos={repos} />
			<RecentGroup repos={repos} />
			<WebhookGroup />
		</div>
	);
}
