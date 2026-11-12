'use client';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { useConnectionsSection } from '@/lib/connections/use-connections-section';

import { FailedGroup } from './failed-group';
import { ForgeGroup } from './forge-group';
import { RepoBrowser } from './repo-browser';
import { RepoGroup } from './repo-group';
import { TokenModal } from './token-modal';

/** Two rows a group, the shape the section has while it loads. */
const SKELETON_GROUPS = [2, 2] as const;

/**
 * Settings → Connections: the forges Recoder reads pull requests from, and
 * the repositories it tracks. A group whose load failed says so in its own
 * card, so the other group still works.
 */
export function ConnectionsSection() {
	const section = useConnectionsSection();

	if (section.view === 'loading') {
		return (
			<div className="connections-loading">
				<SettingsSkeleton groups={SKELETON_GROUPS} />
			</div>
		);
	}

	if (section.view === 'down') return <SectionNotice what="Connections" error={null} retry={section.retry} />;

	return (
		<div className="settings">
			{section.auth ? (
				<ForgeGroup auth={section.auth} onConnect={section.token.connect} />
			) : (
				<FailedGroup title="Forges" reason={section.authError} retry={section.authRetry} />
			)}
			{section.repos ? (
				<RepoGroup repos={section.repos} onAdd={() => section.setBrowsing(true)} />
			) : (
				<FailedGroup title="Repositories" reason={section.reposError} retry={section.reposRetry} />
			)}
			<TokenModal dialog={section.token} />
			<RepoBrowser open={section.browsing} onOpenChange={section.setBrowsing} />
		</div>
	);
}
