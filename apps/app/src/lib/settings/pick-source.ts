'use client';

import type {
	ModelPicks,
	ModelSettings,
	ModelSettingsPatch,
	MyModels,
	MyModelsPatch,
	ReasoningEffort
} from '@recoder/shared';
import { useEffect } from 'react';

import { useIsAdmin } from '../account/use-is-admin';
import { savedPick, type ModelRole, type SavedPick } from './model-options';
import { useMyModels } from './my-models-store';
import { useSettings } from './settings-store';

/** A pick on screen and on its way to a save. A null id unsets the pick, so it follows the Review model. */
export interface PickDraft {
	id: string | null;
	effort: ReasoningEffort | null;
}

/** Where a role's pick lives: the server's settings, or the signed-in member's own picks. */
export type PickSourceKind = 'settings' | 'mine';

/**
 * The picks a member owns are the Review and Subagent models. The Verifier
 * model, and every pick of the admin, are the server's settings.
 */
export function pickSourceKind(role: ModelRole, admin: boolean): PickSourceKind {
	return !admin && role !== 'verifier' ? 'mine' : 'settings';
}

/** The settings fields a role's pick saves to. */
export function settingsPatch(role: ModelRole, { id, effort }: PickDraft): ModelSettingsPatch {
	if (role === 'orchestrator') return { orchestratorModelId: id, orchestratorEffort: effort };
	if (role === 'specialist') return { specialistModelId: id, specialistEffort: effort };

	return { verifierModelId: id, verifierEffort: effort };
}

/** The fields of a member's picks, or of the enforced policy, that a role's pick saves to; the Verifier model has none. */
export function picksPatch(role: ModelRole, { id, effort }: PickDraft): MyModelsPatch {
	if (role === 'orchestrator') return { orchestratorModelId: id, orchestratorEffort: effort };

	return { specialistModelId: id, specialistEffort: effort };
}

/** What a set of member picks holds for a role: the Review model's, or else the Subagent model's. */
export function picksSaved(picks: ModelPicks, role: ModelRole): SavedPick {
	if (role === 'specialist') return { id: picks.specialistModelId, effort: picks.specialistEffort };

	return { id: picks.orchestratorModelId, effort: picks.orchestratorEffort };
}

/**
 * A member's pick as it runs: their own, or, when they have none, the admin's
 * Review model. An unset Subagent model stays unset and follows the Review model.
 */
export function minePick(settings: ModelSettings, mine: MyModels, role: ModelRole): SavedPick {
	if (role === 'orchestrator' && mine.orchestratorModelId === null) return savedPick(settings, role);

	return picksSaved(mine, role);
}

/** What a role's picker reads and where it saves. */
export interface PickSource {
	/** The pick to show; null while it loads. */
	saved: SavedPick | null;
	/** The person cannot change this pick: the admin sets it, or enforces the member's models. */
	locked: boolean;
	save: (draft: PickDraft) => Promise<void>;
}

/**
 * The one place that decides whose pick a picker reads and writes. The admin
 * reads and saves the server's settings. A member reads and saves their own
 * picks, which the admin may enforce; their Verifier model is the admin's.
 */
export function usePickSource(role: ModelRole): PickSource {
	const admin = useIsAdmin();
	const settings = useSettings((state) => state.models);
	const mine = useMyModels((state) => state.mine);
	const status = useMyModels((state) => state.status);
	const personal = pickSourceKind(role, admin) === 'mine';

	useEffect(() => {
		if (personal) void useMyModels.getState().load();
	}, [personal]);

	if (!personal) {
		return {
			saved: settings ? savedPick(settings, role) : null,
			locked: !admin,
			save: (draft) => useSettings.getState().saveModels(settingsPatch(role, draft))
		};
	}

	const save = (draft: PickDraft) => useMyModels.getState().save(picksPatch(role, draft));

	if (!settings) return { saved: null, locked: true, save };
	if (status === 'failed') return { saved: savedPick(settings, role), locked: true, save };
	if (!mine) return { saved: null, locked: true, save };

	return { saved: minePick(settings, mine, role), locked: mine.enforced, save };
}
