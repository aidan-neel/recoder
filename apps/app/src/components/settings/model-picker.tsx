'use client';

import {
	EFFORT_TEXT,
	prettyModelName,
	resolveEffort,
	type ModelSettingsPatch,
	type ReasoningEffort
} from '@recoder/shared';
import { Button, Select, Skeleton, SwapText } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { modelCatalog, ROLE_NAME, rolePick, type ModelRole, type RolePick } from '@/lib/settings/model-options';
import { FOLLOW_ID, FOLLOW_LABEL } from '@/lib/settings/model-rows';
import { useSettings } from '@/lib/settings/settings-store';
import { useInstantSave } from '@/lib/settings/use-save-state';

import { ModelDialog } from './model-dialog';
import { SaveStatus } from './save-status';

interface ModelPickerProps {
	/** `orchestrator` runs the reviewers; `specialist` runs subagents and verifiers. */
	role: ModelRole;
}

/** A pick on screen before the server confirms it. A null id unsets the subagent pick. */
interface Draft {
	id: string | null;
	effort: ReasoningEffort | null;
}

const FAILED = 'Model settings weren’t saved';

function patchFor(role: ModelRole, draft: Draft): ModelSettingsPatch {
	return role === 'orchestrator'
		? { orchestratorModelId: draft.id, orchestratorEffort: draft.effort }
		: { specialistModelId: draft.id, specialistEffort: draft.effort };
}

/** What the trigger reads, and whether it reads as a placeholder. */
function triggerLabel(pick: RolePick): { text: string; quiet: boolean } {
	if (pick.option) return { text: pick.option.name, quiet: false };
	if (pick.follows) return { text: FOLLOW_LABEL, quiet: true };
	if (pick.id) return { text: prettyModelName(pick.id), quiet: false };

	return { text: 'Choose a model', quiet: true };
}

/**
 * A quiet model trigger opening a searchable dialog grouped by provider, with
 * the effort select beside it. A pick saves at once: it shows straight away, a
 * spinner runs while the server saves it, and a failure puts the old pick back
 * with a toast saying why.
 */
export function ModelPicker({ role }: ModelPickerProps) {
	const settings = useSettings((state) => state.models);
	const offline = useSettings((state) => state.status === 'offline');
	const [open, setOpen] = useState(false);
	const instant = useInstantSave((next: Draft) => patchFor(role, next), FAILED);
	const draft = instant.draft?.value;
	const save = instant.change;

	useEffect(() => {
		void useSettings.getState().load();
	}, []);

	if (!settings) {
		return (
			<div data-ui="model-picker" className="model-picker">
				<SaveStatus state="idle" />
				<Button variant="quiet" disabled className="model-trigger" aria-label={ROLE_NAME[role]}>
					{offline ? <span className="text-fg-subtle">Choose a model</span> : <Skeleton className="w-[88px]" />}
				</Button>
			</div>
		);
	}

	const catalog = modelCatalog(settings.models);
	const saved = rolePick(settings, role);

	const pick: RolePick = draft
		? {
				id: draft.id,
				option: draft.id ? catalog.byId.get(draft.id) : undefined,
				effort: draft.effort,
				follows: role === 'specialist' && !draft.id
			}
		: saved;

	const label = triggerLabel(pick);

	function pickModel(id: string): void {
		const option = id === FOLLOW_ID ? undefined : catalog.byId.get(id);
		const next = option ? { id: option.id, effort: resolveEffort(option, pick.effort) } : { id: null, effort: null };

		setOpen(false);

		if (next.id !== pick.id) save(next);
	}

	const efforts = pick.option?.efforts;

	return (
		<div data-ui="model-picker" className="model-picker">
			<SaveStatus state={instant.state} />
			<Button
				variant="quiet"
				className="model-trigger"
				disabled={catalog.count === 0}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={`${ROLE_NAME[role]}: ${label.text}`}
				onClick={() => setOpen(true)}
			>
				<SwapText
					id={pick.id ?? 'none'}
					className="model-trigger-label"
					textClassName={label.quiet ? 'text-fg-subtle' : undefined}
				>
					{label.text}
				</SwapText>
			</Button>
			{efforts && pick.effort && pick.option ? (
				<Select
					variant="quiet"
					value={pick.effort}
					onValueChange={(effort) => {
						if (pick.option && effort !== pick.effort) save({ id: pick.option.id, effort: effort as ReasoningEffort });
					}}
					options={efforts.map((effort) => ({
						value: effort,
						label: EFFORT_TEXT[effort].label,
						description: EFFORT_TEXT[effort].description
					}))}
					aria-label={`${ROLE_NAME[role]} reasoning effort`}
					className="effort-trigger"
					contentClassName="effort-menu"
				/>
			) : null}
			<ModelDialog
				open={open}
				onOpenChange={setOpen}
				role={role}
				catalog={catalog}
				current={pick.id ?? (pick.follows ? FOLLOW_ID : null)}
				onPick={pickModel}
			/>
		</div>
	);
}
