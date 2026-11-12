'use client';

import type { Repo } from '@recoder/shared';
import { Button } from '@recoder/ui';
import Link from 'next/link';

import { ForgeTile } from '@/components/common/forge-tile';
import { OFFLINE_TEXT } from '@/lib/api/http';
import type { AutoReviewSection } from '@/lib/settings/use-auto-review-section';
import { useWatchRepo, type WatchRepoView } from '@/lib/settings/use-watch-repo';
import { settingsHref } from '@/lib/shell/routes';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { SwitchRow } from './switch-row';

/** Reads the page's settings and the tracked repositories again. */
type Retry = AutoReviewSection['retry'];

/** What a repository's row says about its switch. */
function watchDetail(view: WatchRepoView): string {
	if (view.disabled) return 'A local clone has no comments to watch';

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

/** Nothing is tracked yet: repositories are added in Connections. */
function NoRepositories() {
	return (
		<SettingsRow name="No repositories yet" detail="The watcher checks the repositories you track">
			<Button asChild variant="outline">
				<Link href={settingsHref('connections')}>Open Connections</Link>
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

/** Automations → Repositories: every tracked repository, each watched unless switched off. */
export function RepositoriesGroup(props: RepositoriesGroupProps) {
	return (
		<SettingsGroup title="Repositories">
			<RepositoryRows {...props} />
		</SettingsGroup>
	);
}
