'use client';

import {
	EFFORT_TEXT,
	prettyModelName,
	resolveEffort,
	type ModelSettingsPatch,
	type ReasoningEffort
} from '@recoder/shared';
import { useEffect, useState } from 'react';

import { missingNote, modelCatalog, rolePick, type ModelCatalog, type ModelRole, type RolePick } from './model-options';
import { FOLLOW_ID, FOLLOW_LABEL } from './model-rows';
import { useSettings } from './settings-store';
import { useInstantSave, type SaveState } from './use-save-state';

/** A pick on screen before the server confirms it. A null id unsets the subagent pick. */
interface Draft {
	id: string | null;
	effort: ReasoningEffort | null;
}

const FAILED = 'Model settings weren’t saved';

const EMPTY_CATALOG: ModelCatalog = { groups: [], byId: new Map(), count: 0 };

function patchFor(role: ModelRole, draft: Draft): ModelSettingsPatch {
	return role === 'orchestrator'
		? { orchestratorModelId: draft.id, orchestratorEffort: draft.effort }
		: { specialistModelId: draft.id, specialistEffort: draft.effort };
}

/** What the trigger reads, and whether it reads as a placeholder. */
function triggerLabel(pick: RolePick): { text: string; quiet: boolean } {
	if (missingNote(pick))
		return { text: `${pick.option?.name ?? prettyModelName(pick.id ?? '')} · missing`, quiet: true };
	if (pick.option) return { text: pick.option.name, quiet: false };
	if (pick.follows) return { text: FOLLOW_LABEL, quiet: true };
	if (pick.id) return { text: prettyModelName(pick.id), quiet: false };

	return { text: 'Choose a model', quiet: true };
}

/** The pick a draft shows: its model's catalog entry when it names one, and whether it follows the Review model. */
function draftPick(draft: Draft, catalog: ModelCatalog, role: ModelRole): RolePick {
	return {
		id: draft.id,
		option: draft.id ? catalog.byId.get(draft.id) : undefined,
		effort: draft.effort,
		follows: role === 'specialist' && !draft.id
	};
}

/** The dialog's row key for a pick: its model id, or the follow row for an unset subagent pick. */
function pickKey(pick: RolePick): string | null {
	return pick.id ?? (pick.follows ? FOLLOW_ID : null);
}

/** Everything a role's model picker shows and does: the trigger, the effort select and the search dialog. */
export interface ModelPickerView {
	/** Settings are still loading; the trigger reads as a placeholder. */
	loading: boolean;
	/** The server is down; the placeholder says so instead of shimmering. */
	offline: boolean;
	/** The pick on screen (a draft while its save runs, else the saved one); null while loading. */
	pick: RolePick | null;
	/** What the trigger reads, and whether it reads as a placeholder. */
	label: { text: string; quiet: boolean } | null;
	/** The effort the pick runs at; null when its model has no reasoning control. */
	effort: ReasoningEffort | null;
	/** The efforts the pick's model accepts, for the effort select; null when it has none or none is picked. */
	effortOptions: { value: ReasoningEffort; label: string; description: string }[] | null;
	/** The catalog has models to pick; false disables the trigger. */
	canOpen: boolean;
	/** Where the pick's save stands. */
	state: SaveState;
	open: boolean;
	setOpen: (open: boolean) => void;
	/** The dialog's current row key: the pick's id, or the follow row for an unset subagent pick. */
	current: string | null;
	/** The grouped catalog the dialog lays out. */
	catalog: ModelCatalog;
	/** Picks a model from the dialog (FOLLOW_ID follows the Review model); closes the dialog and saves when it changed. */
	pickModel: (id: string) => void;
	/** Saves a new effort for the picked model, when its model accepts it. */
	chooseEffort: (effort: ReasoningEffort) => void;
}

/**
 * A quiet model trigger opening a searchable dialog grouped by provider, with
 * the effort select beside it. A pick saves at once: it shows straight away, a
 * spinner runs while the server saves it, and a failure puts the old pick back
 * with a toast saying why. Effort options come from the model's capabilities.
 */
export function useModelPicker(role: ModelRole): ModelPickerView {
	const settings = useSettings((state) => state.models);
	const offline = useSettings((state) => state.status === 'offline');
	const [open, setOpen] = useState(false);
	const instant = useInstantSave((next: Draft) => patchFor(role, next), FAILED);
	const draft = instant.draft?.value;
	const save = instant.change;

	useEffect(() => {
		void useSettings.getState().load();
	}, []);

	const catalog = settings ? modelCatalog(settings.models) : EMPTY_CATALOG;
	const saved = settings ? rolePick(settings, role) : null;

	let pick: RolePick | null = null;

	if (saved) pick = draft ? draftPick(draft, catalog, role) : saved;

	const current = pick ? pickKey(pick) : null;

	function pickModel(id: string): void {
		if (!pick) return;

		const option = id === FOLLOW_ID ? undefined : catalog.byId.get(id);
		const next = option ? { id: option.id, effort: resolveEffort(option, pick.effort) } : { id: null, effort: null };

		setOpen(false);

		if (next.id !== pick.id) save(next);
	}

	function chooseEffort(effort: ReasoningEffort): void {
		if (pick?.option && effort !== pick.effort) save({ id: pick.option.id, effort });
	}

	const efforts = pick?.option?.efforts;

	const effortOptions =
		pick?.option && pick.effort && efforts
			? efforts.map((effort) => ({
					value: effort,
					label: EFFORT_TEXT[effort].label,
					description: EFFORT_TEXT[effort].description
				}))
			: null;

	return {
		loading: !settings,
		offline,
		pick,
		label: pick ? triggerLabel(pick) : null,
		effort: pick?.effort ?? null,
		effortOptions,
		canOpen: catalog.count > 0,
		state: instant.state,
		open,
		setOpen,
		current,
		catalog,
		pickModel,
		chooseEffort
	};
}
