'use client';

import { Button, NumberField } from '@recoder/ui';
import { useMemo } from 'react';

import {
	contextWindowDetail,
	contextWindowPick,
	pickedModelIds,
	type ContextWindowPick
} from '@/lib/settings/context-windows';
import { useSettings } from '@/lib/settings/settings-store';
import { useContextWindow } from '@/lib/settings/use-context-window';

import { SettingsGroup, SettingsRow } from './settings-group';

/** One picked model: where its window comes from, the window in tokens, and Reset while one is set. */
function ContextWindowRow({ pick }: { pick: ContextWindowPick }) {
	const view = useContextWindow(pick);
	const { field } = view;
	const label = `${pick.name} context window`;

	return (
		<SettingsRow name={pick.name} detail={contextWindowDetail(pick)} error={field.error} state={view.state}>
			{pick.set === null ? null : (
				<Button variant="quiet" onClick={view.reset}>
					Reset
				</Button>
			)}
			<NumberField
				className="settings-number-wide"
				aria-label={label}
				aria-valuemin={field.min}
				aria-valuemax={field.max}
				aria-valuenow={field.valueNow ?? undefined}
				canDecrement={field.canDecrement}
				canIncrement={field.canIncrement}
				invalid={field.error !== null}
				value={field.text}
				onStep={field.step}
				onChange={(event) => field.edit(event.target.value)}
				onBlur={field.blur}
				onKeyDown={field.onKeyDown}
			/>
		</SettingsRow>
	);
}

/**
 * Settings → Models, the context windows: tokens per request for each model
 * the picks run on. A model starts on what its provider reports, else the
 * default; a window set here wins until it is reset.
 */
export function ContextWindows() {
	const settings = useSettings((state) => state.models);

	const picks = useMemo(
		() => (settings ? pickedModelIds(settings).map((id) => contextWindowPick(settings, id)) : []),
		[settings]
	);

	if (picks.length === 0) return null;

	return (
		<SettingsGroup title="Context windows">
			{picks.map((pick) => (
				<ContextWindowRow key={pick.id} pick={pick} />
			))}
		</SettingsGroup>
	);
}
