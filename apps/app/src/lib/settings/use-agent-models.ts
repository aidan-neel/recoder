'use client';

import { useShallow } from 'zustand/react/shallow';

import { agentReady, useSettings } from './settings-store';
import { missingNote, MODEL_ROLES, ROLE_NAME, rolePick, type ModelRole } from './model-options';

/** One model pick's row: its name, what it does, and why it can't run when it can't. */
export interface ModelRowView {
	role: ModelRole;
	/** The row's name: "Review model", "Subagent model", "Verifier model". */
	name: string;
	/** What the pick runs; null when the pick can't run, in which case `note` says why. */
	description: string | null;
	/** Why the pick can't run, or null when it can. */
	note: string | null;
}

/** What each pick runs; a pick that can no longer run says so in `note` instead. */
const ROLE_TEXT: Record<ModelRole, string> = {
	orchestrator: 'Runs the reviewers, the summary and Orchestrator in chat',
	specialist: 'Answers the questions reviewers hand off',
	verifier: 'Checks each finding before it shows'
};

/** Everything the Models group shows: whether it shows at all, and each pick's row. */
export interface AgentModelsView {
	/** An agent is ready or models are listed; without either the group hides. */
	offered: boolean;
	rows: ModelRowView[];
}

/**
 * Settings → Models, bottom half: the Review model, the Subagent model and the
 * Verifier model. Each row's picker is `useModelPicker(role)`.
 */
export function useAgentModels(): AgentModelsView {
	const offered = useSettings((state) => state.agents.some(agentReady) || Boolean(state.models?.models.length));

	const notes = useSettings(
		useShallow((state) => {
			const models = state.models;

			return models ? MODEL_ROLES.map((role) => missingNote(rolePick(models, role))) : null;
		})
	);

	const rows: ModelRowView[] = MODEL_ROLES.map((role, at) => {
		const note = notes?.[at] ?? null;

		return { role, name: ROLE_NAME[role], description: note ? null : ROLE_TEXT[role], note };
	});

	return { offered, rows };
}
