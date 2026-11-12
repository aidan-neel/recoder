'use client';

import { useAgentSection } from '@/lib/settings/use-agent-section';

import { AgentClis } from './agent-clis';
import { ModelPicks } from './model-picks';
import { ProvidersGroup } from './providers/providers-group';
import { ServerSection } from './server-section';
import { VllmServers } from './vllm-servers';

/** The row counts of the four groups, for the skeleton that stands in while settings load. */
const GROUP_ROWS = [2, 2, 1, 3];

/** The groups themselves, mounted once the server's settings are in. */
function ModelsGroups() {
	const section = useAgentSection();

	return (
		<div className="settings">
			<ModelPicks />
			<ProvidersGroup section={section} />
			<VllmServers />
			<AgentClis />
		</div>
	);
}

/** Settings → Models: the review models, the providers, local servers and agent CLIs. */
export function ModelsSection() {
	return (
		<ServerSection groups={GROUP_ROWS}>
			<ModelsGroups />
		</ServerSection>
	);
}
