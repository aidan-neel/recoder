'use client';

import { useAccount } from '@/lib/account/account-store';

import { AccountGroup } from '@/components/account/account-group';
import { AdminControls } from '@/components/settings/admin-controls';
import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { useConnectionsSection } from '@/lib/connections/use-connections-section';

import { FailedGroup } from './failed-group';
import { ForgeGroup } from './forge-group';
import { TokenModal } from './token-modal';

/** The Forges group's two rows, the shape the section has while it loads; with an account, its one row leads. */
const FORGES_SKELETON = [2] as const;

const ACCOUNT_SKELETON = [1, 2] as const;

/** Settings → Connections: the forges Recoder reads pull requests from. */
export function ConnectionsSection() {
	const section = useConnectionsSection();
	const hasAccount = useAccount((state) => Boolean(state.auth?.account));

	if (section.view === 'loading') {
		return (
			<div className="connections-loading">
				<SettingsSkeleton groups={hasAccount ? ACCOUNT_SKELETON : FORGES_SKELETON} />
			</div>
		);
	}

	if (section.view === 'down') return <SectionNotice what="Connections" error={null} retry={section.retry} />;

	return (
		<div className="settings">
			<AccountGroup />
			<AdminControls>
				{section.auth ? (
					<ForgeGroup auth={section.auth} onConnect={section.token.connect} />
				) : (
					<FailedGroup title="Forges" reason={section.authError} retry={section.retry} />
				)}
			</AdminControls>
			<TokenModal dialog={section.token} />
		</div>
	);
}
