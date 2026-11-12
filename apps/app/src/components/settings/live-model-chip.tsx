'use client';

import { useEffect } from 'react';

import { missingNote, rolePick } from '@/lib/settings/model-options';
import { useSettings } from '@/lib/settings/settings-store';

import { ModelChip } from '@/components/shell/model-chip';

/** The chip's words before a model is picked. */
const NOT_SET_UP = 'Set up a model';

/** The chip's words until Settings has answered. */
const LOADING = 'Review model';

/**
 * The review model from Settings, at the foot of the sidebar: its name with
 * a green dot when reviews can run, an amber one when no model is picked,
 * and a quiet one while Settings loads or the picked model stopped answering.
 */
export function LiveModelChip() {
	const models = useSettings((state) => state.models);

	useEffect(() => void useSettings.getState().load(), []);

	if (!models) return <ModelChip label={LOADING} state="off" />;

	const pick = rolePick(models, 'orchestrator');

	if (!pick.option) return <ModelChip label={NOT_SET_UP} state="missing" />;

	return <ModelChip label={pick.option.name} state={missingNote(pick) ? 'off' : 'ready'} />;
}
