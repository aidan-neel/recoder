'use client';

import { SegmentedControl } from '@recoder/ui';

import { SERVER_VIEWS, serverViewOf, type ServerView } from '@/lib/server/server-views';
import { navigate } from '@/lib/shell/navigation';
import { settingsHref } from '@/lib/shell/routes';

import { BackupsView } from './backups-view';
import { BranchGroup } from './branch-group';
import { LogsView } from './logs-view';
import { OverviewView } from './overview-view';
import { UpdateCard } from './update-card';
import { UpdateHistory } from './update-history';
import { UpdatePolicyGroup } from './update-policy';

/** The page bar's pick of Settings → Server's views; each is its own address, so back and forward step between them. */
export function ServerViews({ view }: { view: ServerView }) {
	return (
		<SegmentedControl
			aria-label="Server"
			value={view}
			options={[...SERVER_VIEWS]}
			onValueChange={(next) => navigate(settingsHref('server', serverViewOf(next) ?? 'overview'))}
		/>
	);
}

/** Settings → Server → Updates: the release waiting or running, how updates install, and what ran before. */
function UpdatesView() {
	return (
		<div className="settings">
			<UpdateCard />
			<UpdatePolicyGroup />
			<BranchGroup />
			<UpdateHistory />
		</div>
	);
}

/** Settings → Server: how this server runs, its updates, its backups and its log. */
export function ServerSettings({ view }: { view: ServerView }) {
	switch (view) {
		case 'overview':
			return <OverviewView />;
		case 'updates':
			return <UpdatesView />;
		case 'backups':
			return <BackupsView />;
		case 'logs':
			return <LogsView />;
	}
}
