'use client';

import { ROLE_NAME } from '@/lib/settings/model-options';
import { modelsOffered, retrySettings, useSettings } from '@/lib/settings/settings-store';

import { FailedGroup } from './group-notice';
import { ModelPicker } from './model-picker';
import { MODEL_TEXT } from './row-copy';
import { SettingsGroup, SettingsRow } from './settings-group';

const TITLE = 'Models';

/**
 * Settings → Agent, bottom half: the Review model and the Subagent model,
 * which also runs the verifiers. With no model to offer it says so in place
 * of the pickers.
 */
export function AgentModels() {
	const status = useSettings((state) => state.status);
	const error = useSettings((state) => state.error);
	const offered = useSettings(modelsOffered);

	if (status === 'offline') {
		return <FailedGroup title={TITLE} what="Couldn’t load the models." reason={error} retry={retrySettings} />;
	}

	if (!offered) {
		return (
			<SettingsGroup title={TITLE} group="models">
				<SettingsRow name="No models yet" description="Get an agent CLI ready to pick the review models" />
			</SettingsGroup>
		);
	}

	return (
		<SettingsGroup title={TITLE} group="models">
			<SettingsRow name={ROLE_NAME.orchestrator} description={MODEL_TEXT.orchestrator}>
				<ModelPicker role="orchestrator" />
			</SettingsRow>
			<SettingsRow name={ROLE_NAME.specialist} description={MODEL_TEXT.specialist}>
				<ModelPicker role="specialist" />
			</SettingsRow>
		</SettingsGroup>
	);
}
