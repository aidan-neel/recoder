'use client';

import { agentReady, useSettings } from './settings-store';
import { missingNote, ROLE_NAME, rolePick, type ModelRole } from './model-options';

/** One model pick's row: its name, what it does, and why it can't run when it can't. */
export interface ModelRowView {
	role: ModelRole;
	/** The row's name: "Review model", "Subagent model". */
	name: string;
	/** What the pick runs; null when the pick can't run, in which case `note` says why. */
	description: string | null;
	/** Why the pick can't run, or null when it can. */
	note: string | null;
}

/** What each pick runs; a pick that can no longer run says so in `note` instead. */
const ROLE_TEXT: Record<ModelRole, string> = {
	orchestrator: 'Runs the reviewers, the summary and Orchestrator in chat',
	specialist: 'Answers the questions reviewers hand off and checks each finding'
};

/** Everything the Models group shows: whether it shows at all, and each pick's row. */
export interface AgentModelsView {
	/** An agent is ready or models are listed; without either the group hides. */
	offered: boolean;
	rows: ModelRowView[];
}

/**
 * Settings → Agent, bottom half: the Review model and the Subagent model,
 * which also runs the verifiers. Each row's picker is `useModelPicker(role)`.
 */
export function useAgentModels(): AgentModelsView {
	const offered = useSettings((state) => state.agents.some(agentReady) || Boolean(state.models?.models.length));

	const notes = useSettings((state) =>
		state.models
			? {
					orchestrator: missingNote(rolePick(state.models, 'orchestrator')),
					specialist: missingNote(rolePick(state.models, 'specialist'))
				}
			: null
	);

	const rows: ModelRowView[] = (['orchestrator', 'specialist'] as const).map((role) => {
		const note = notes?.[role] ?? null;

		return { role, name: ROLE_NAME[role], description: note ? null : ROLE_TEXT[role], note };
	});

	return { offered, rows };
}
