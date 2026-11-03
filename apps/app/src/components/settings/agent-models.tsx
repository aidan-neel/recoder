'use client';

import { missingNote, ROLE_NAME, rolePick, type ModelRole } from '@/lib/settings/model-options';
import { agentReady, useSettings } from '@/lib/settings/settings-store';

import { ModelPicker } from './model-picker';
import { SettingsGroup, SettingsRow } from './settings-group';

/** What each pick runs; a pick that can no longer run says so here instead. */
const ROLE_TEXT: Record<ModelRole, string> = {
	orchestrator: 'Runs the reviewers, the summary and Orchestrator in chat',
	specialist: 'Answers the questions reviewers hand off and checks each finding'
};

/** One pick's row: its name, what it does or why it can't run, and its picker. */
function ModelRow({ role }: { role: ModelRole }) {
	const note = useSettings((state) => (state.models ? missingNote(rolePick(state.models, role)) : null));

	return (
		<SettingsRow
			name={ROLE_NAME[role]}
			description={note ? <span className="text-danger">{note}</span> : ROLE_TEXT[role]}
		>
			<ModelPicker role={role} />
		</SettingsRow>
	);
}

/** Settings → Agent, bottom half: the Review model and the Subagent model, which also runs the verifiers. */
export function AgentModels() {
	const offered = useSettings((state) => state.agents.some(agentReady) || Boolean(state.models?.models.length));

	if (!offered) return null;

	return (
		<SettingsGroup title="Models">
			<ModelRow role="orchestrator" />
			<ModelRow role="specialist" />
		</SettingsGroup>
	);
}
