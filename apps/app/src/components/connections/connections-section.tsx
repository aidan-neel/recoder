'use client';

import { Button } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useConnections, type LoadStatus } from '@/lib/connections/connections-store';
import { useAction } from '@/lib/shell/use-action';

import { ForgeGroup } from './forge-group';
import { RepoBrowser } from './repo-browser';
import { RepoGroup } from './repo-group';
import { useTokenDialog } from './use-token-dialog';

/** Two rows a group, the shape the section paints while it loads. */
const SKELETON_GROUPS = [2, 2];

/** True once a load has answered, well or not. */
function settled(status: LoadStatus): boolean {
	return status !== 'idle' && status !== 'loading';
}

/** Loads the forges and the repositories. On a retry, a failure stays on screen until the answer lands, so the notice holds still. */
function reload(): Promise<unknown> {
	const { loadAuth, loadRepos } = useConnections.getState();

	return Promise.all([loadAuth(), loadRepos()]);
}

/** A group whose load failed: what went wrong, and a way to try again. */
function FailedGroup({ title, name, reason }: { title: string; name: string; reason: string | null }) {
	const retry = useAction();

	return (
		<SettingsGroup title={title}>
			<SettingsRow name={name} description={reason ?? OFFLINE_TEXT}>
				<Button variant="outline" status={retry.status} onClick={() => retry.run(reload)}>
					Try again
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}

/** The whole section when the review server does not answer. */
function ServerDown() {
	const retry = useAction();

	return (
		<PageNotice heading="h2" lead={OFFLINE_TEXT} rest="Start it, then try again.">
			<Button status={retry.status} onClick={() => retry.run(reload)}>
				Try again
			</Button>
		</PageNotice>
	);
}

/**
 * Settings → Connections: the forges Recoder reads pull requests from, and
 * the repositories it tracks. The section paints once both have loaded.
 */
export function ConnectionsSection() {
	const auth = useConnections((state) => state.auth);
	const authStatus = useConnections((state) => state.authStatus);
	const authError = useConnections((state) => state.authError);
	const repos = useConnections((state) => state.repos);
	const reposStatus = useConnections((state) => state.reposStatus);
	const reposError = useConnections((state) => state.reposError);
	const [browsing, setBrowsing] = useState(false);
	const token = useTokenDialog();

	useEffect(() => {
		void reload();
	}, []);

	if (!repos && reposStatus === 'offline') return <ServerDown />;
	if (!settled(authStatus) || !settled(reposStatus)) return <SettingsSkeleton groups={SKELETON_GROUPS} />;

	return (
		<div className="settings-stack">
			{auth ? (
				<ForgeGroup auth={auth} onConnect={token.connect} />
			) : (
				<FailedGroup title="Forges" name="Couldn’t check the forges" reason={authError} />
			)}
			{repos ? (
				<RepoGroup repos={repos} onAdd={() => setBrowsing(true)} />
			) : (
				<FailedGroup title="Repositories" name="Couldn’t load the repositories" reason={reposError} />
			)}
			{token.dialog}
			<RepoBrowser open={browsing} onOpenChange={setBrowsing} />
		</div>
	);
}
