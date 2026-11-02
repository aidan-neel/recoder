'use client';

import type { Repo } from '@recoder/shared';
import { Button, ForgeMark, Switch } from '@recoder/ui';

import { useAutoReview } from '@/lib/settings/auto-review-store';
import { openSettings } from '@/lib/settings/settings-url';
import { useInstantChange } from '@/lib/settings/use-save-state';

import { SaveStatus } from '../save-status';
import { SettingsGroup, SettingsRow } from '../settings-group';
import { AUTO_REVIEW_FAILED } from './toggle-row';

/** One tracked repository and whether the watcher checks it. A local clone has no comments or pull requests to watch. */
function RepoRow({ repo }: { repo: Repo }) {
	const watched = useAutoReview((state) => !state.payload?.settings.excludedRepoIds.includes(repo.id));
	const local = repo.provider === 'local';

	const toggle = useInstantChange((on: boolean) => useAutoReview.getState().watchRepo(repo.id, on), AUTO_REVIEW_FAILED);

	const on = !local && (toggle.draft ? toggle.draft.value : watched);

	return (
		<SettingsRow
			name={repo.name}
			description={local ? 'A local clone has no comments to watch' : on ? 'Watched' : 'Left alone'}
			leading={<ForgeMark provider={repo.provider} className="text-fg-subtle" />}
		>
			<SaveStatus state={toggle.state} />
			<Switch checked={on} disabled={local} onCheckedChange={toggle.change} aria-label={`Watch ${repo.name}`} />
		</SettingsRow>
	);
}

/** Settings → Auto-review → Repositories: every tracked repository, each watched unless switched off. */
export function ReposGroup({ repos }: { repos: Repo[] }) {
	return (
		<SettingsGroup title="Repositories">
			{repos.length ? (
				repos.map((repo) => <RepoRow key={repo.id} repo={repo} />)
			) : (
				<SettingsRow name="No repositories tracked" description="The watcher checks the repositories you track">
					<Button variant="outline" onClick={() => openSettings('connections')}>
						Open Connections
					</Button>
				</SettingsRow>
			)}
		</SettingsGroup>
	);
}
