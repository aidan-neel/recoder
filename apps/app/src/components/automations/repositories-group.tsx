'use client';

import type { Repo } from '@recoder/shared';
import { Button } from '@recoder/ui';

import { ForgeTile } from '@/components/common/forge-tile';
import { OFFLINE_TEXT } from '@/lib/api/http';
import type { AutoReviewSection } from '@/lib/settings/use-auto-review-section';
import { useAutoReviewSwitch } from '@/lib/settings/use-auto-review-switch';
import { useWatchRepo, type WatchRepoView } from '@/lib/settings/use-watch-repo';
import { openSettings } from '@/lib/settings/open-settings';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { SwitchRow } from './switch-row';

/** Reads the page's settings and the tracked repositories again. */
type Retry = AutoReviewSection['retry'];

const OWN_ONLY = 'Only my repositories';

/** What a repository's row says about its switch. */
function watchDetail(view: WatchRepoView): string {
	if (view.hold === 'local') return 'A local clone has no comments to watch';
	if (view.hold === 'notOwned') return 'Not yours, so not watched';

	return view.on ? 'Watched' : 'Not watched';
}

/** One tracked repository and whether the watcher checks it. */
function RepositoryRow({ repo }: { repo: Repo }) {
	const view = useWatchRepo(repo);

	return (
		<SwitchRow
			leading={<ForgeTile provider={repo.provider} />}
			name={repo.name}
			label={`Watch ${repo.name}`}
			detail={watchDetail(view)}
			toggle={view}
		/>
	);
}

/** Watch only the repositories the connected account owns, or every tracked one. */
function OwnReposRow() {
	const toggle = useAutoReviewSwitch('ownReposOnly');

	return (
		<SwitchRow
			name={OWN_ONLY}
			label={OWN_ONLY}
			detail={
				toggle.on ? 'Repositories your GitHub or GitLab account owns' : 'Every tracked repository, organizations’ too'
			}
			toggle={toggle}
		/>
	);
}

/** Nothing is tracked yet: repositories are added in Connections. */
function NoRepositories() {
	return (
		<SettingsRow name="No repositories yet" detail="The watcher checks the repositories you track">
			<Button variant="outline" onClick={() => openSettings('connections')}>
				Open Connections
			</Button>
		</SettingsRow>
	);
}

/** The list did not load while the settings did: say why, and offer to read it again. */
function LoadFailed({ error, retry }: { error: string | null; retry: Retry }) {
	return (
		<SettingsRow name="Repositories did not load" detail={error ?? OFFLINE_TEXT}>
			<Button variant="outline" status={retry.status} onClick={retry.run}>
				Try again
			</Button>
		</SettingsRow>
	);
}

type RepositoriesGroupProps = Pick<AutoReviewSection, 'repos' | 'reposState' | 'reposError' | 'retry'>;

/** The group's rows: one per repository, or why there are none. */
function RepositoryRows({ repos, reposState, reposError, retry }: RepositoriesGroupProps) {
	if (reposState === 'failed') return <LoadFailed error={reposError} retry={retry} />;

	if (repos.length === 0) return <NoRepositories />;

	return repos.map((repo) => <RepositoryRow key={repo.id} repo={repo} />);
}

/**
 * Automations → Repositories: whether only your own repositories are watched, then every tracked repository, each
 * watched unless switched off.
 */
export function RepositoriesGroup(props: RepositoriesGroupProps) {
	return (
		<SettingsGroup title="Repositories">
			<OwnReposRow />
			<RepositoryRows {...props} />
		</SettingsGroup>
	);
}
