'use client';

import { useEffect, useState } from 'react';

import { FailedGroup, SectionNotice } from '@/components/settings/group-notice';
import { SettingsSectionSkeleton } from '@/components/settings/settings-skeleton';
import { retryAuth, retryRepos, useConnections } from '@/lib/connections/connections-store';
import { pending } from '@/lib/settings/settings-store';

import { ForgeGroup } from './forge-group';
import { RepoBrowser } from './repo-browser';
import { AddRepository, RepoGroup } from './repo-group';
import { useTokenDialog, type Connect } from './use-token-dialog';

/** Loads the forges and the repositories again; rejects while either still fails. */
async function retryBoth(): Promise<void> {
	const results = await Promise.allSettled([retryAuth(), retryRepos()]);

	if (results.some((result) => result.status === 'rejected')) throw new Error('Connections didn’t load.');
}

/** GitHub and GitLab: who each is signed in as, once the section has loaded. */
function Forges({ onConnect }: { onConnect: Connect }) {
	const auth = useConnections((state) => state.auth);
	const error = useConnections((state) => state.authError);

	if (auth) return <ForgeGroup auth={auth} onConnect={onConnect} />;

	return <FailedGroup title="Forges" what="Couldn’t check the forges." reason={error} retry={retryAuth} />;
}

/** The tracked repositories, once the section has loaded. */
function Repositories({ onAdd }: { onAdd: () => void }) {
	const repos = useConnections((state) => state.repos);
	const error = useConnections((state) => state.reposError);

	if (repos) return <RepoGroup repos={repos} onAdd={onAdd} />;

	return <FailedGroup title="Repositories" what="Couldn’t load the repositories." reason={error} retry={retryRepos} />;
}

/**
 * Settings → Connections: the forges Recoder reads pull requests from, and
 * the repositories it tracks. The section paints once both have answered, in
 * one swap from its skeleton, so neither group lands while the other is
 * still a placeholder; Add repository works in the skeleton already. When
 * the server answers neither, one notice stands for both. The dialogs stay
 * mounted across the swap, so one opened from the skeleton stays open.
 */
export function ConnectionsSection() {
	const down = useConnections(
		(state) => !state.auth && state.authStatus === 'offline' && !state.repos && state.reposStatus === 'offline'
	);

	const loading = useConnections(
		(state) =>
			(state.auth === null && pending(state.authStatus)) || (state.repos === null && pending(state.reposStatus))
	);

	const [browsing, setBrowsing] = useState(false);
	const token = useTokenDialog();

	useEffect(() => {
		const { loadAuth, loadRepos } = useConnections.getState();

		void loadAuth();
		void loadRepos();
	}, []);

	if (down) return <SectionNotice what="Connections didn’t load." reason={null} retry={retryBoth} />;

	return (
		<>
			{loading ? (
				<SettingsSectionSkeleton
					section="connections"
					actions={{ repos: <AddRepository onAdd={() => setBrowsing(true)} /> }}
				/>
			) : (
				<div className="settings-stack">
					<Forges onConnect={token.connect} />
					<Repositories onAdd={() => setBrowsing(true)} />
				</div>
			)}
			{token.dialog}
			<RepoBrowser open={browsing} onOpenChange={setBrowsing} />
		</>
	);
}
