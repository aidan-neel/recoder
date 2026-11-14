'use client';

import { useIsAdmin } from '@/lib/account/use-is-admin';

import { ModelChooser } from './model-chooser';
import { ModelPicks } from './model-picks';
import { ServerSection } from './server-section';
import { VllmServers } from './vllm-servers';

/** The row counts of the groups, for the skeleton that stands in while settings load. */
const GROUP_ROWS = [2, 1];

/**
 * Settings → Models: the review models, which models the pickers offer, and
 * the local servers. A member's pickers are their own; which models are
 * offered and the local servers are the admin's, so a member sees only the
 * picks (the local servers' models already show in them). Agent CLIs and
 * model providers are under Providers.
 */
export function ModelsSection() {
	const admin = useIsAdmin();

	return (
		<ServerSection groups={GROUP_ROWS}>
			<div className="settings">
				<ModelPicks />
				{admin ? <ModelChooser /> : null}
				{admin ? <VllmServers /> : null}
			</div>
		</ServerSection>
	);
}
