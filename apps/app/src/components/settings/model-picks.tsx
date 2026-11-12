'use client';

import { useAgentModels, type ModelRowView } from '@/lib/settings/use-agent-models';
import { useModelPicker } from '@/lib/settings/use-model-picker';

import { ModelPicker } from './model-picker';
import { SettingsGroup, SettingsRow } from './settings-group';

/** One pick's row: its name, what it runs or why it cannot run, and its picker with the save state beside it. */
function ModelPickRow({ row }: { row: ModelRowView }) {
	const picker = useModelPicker(row.role);

	return (
		<SettingsRow name={row.name} detail={row.description} error={row.note} state={picker.state}>
			<ModelPicker role={row.role} picker={picker} />
		</SettingsRow>
	);
}

/** The Review model and the Subagent model. Hidden until an agent is ready or a model is listed. */
export function ModelPicks() {
	const view = useAgentModels();

	if (!view.offered) return null;

	return (
		<SettingsGroup title="Review models">
			{view.rows.map((row) => (
				<ModelPickRow key={row.role} row={row} />
			))}
		</SettingsGroup>
	);
}
