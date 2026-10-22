'use client';

import { ROLE_NAME } from '@/lib/settings/model-options';
import { agentReady, useSettings } from '@/lib/settings/settings-store';

import { ModelPicker } from './model-picker';
import { SettingsGroup, SettingsRow } from './settings-group';

/** Settings → Agent, bottom half: the Review model and the Subagent model, which also runs the verifiers. */
export function AgentModels() {
	const offered = useSettings((state) => state.agents.some(agentReady) || Boolean(state.models?.models.length));

	if (!offered) return null;

	return (
		<SettingsGroup title="Models">
			<SettingsRow name={ROLE_NAME.orchestrator} description="Runs the reviewers, the summary and Orchestrator in chat">
				<ModelPicker role="orchestrator" />
			</SettingsRow>
			<SettingsRow
				name={ROLE_NAME.specialist}
				description="Answers the questions reviewers hand off and checks each finding"
			>
				<ModelPicker role="specialist" />
			</SettingsRow>
		</SettingsGroup>
	);
}
