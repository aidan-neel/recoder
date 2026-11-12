'use client';

import type { ReasoningEffort } from '@recoder/shared';
import { Button, Select, Skeleton, SwapText } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';

import { ROLE_NAME, type ModelRole } from '@/lib/settings/model-options';
import type { ModelPickerView } from '@/lib/settings/use-model-picker';

import { ModelDialog } from './model-dialog';

/** The trigger's words while no pick can be read. */
const NO_PICK = 'Choose a model';

/** What the trigger reads: the pick, a placeholder when the server is down, or a bar while settings load. */
function TriggerLabel({ picker }: { picker: ModelPickerView }) {
	if (picker.label) {
		return (
			<SwapText
				id={picker.current ?? 'none'}
				titled
				className="model-trigger-label"
				textClassName={picker.label.quiet ? 'model-trigger-quiet' : undefined}
			>
				{picker.label.text}
			</SwapText>
		);
	}

	if (picker.offline) return <span className="model-trigger-quiet">{NO_PICK}</span>;

	return <Skeleton style={{ width: 88 }} />;
}

interface EffortSelectProps {
	/** The role's name, for the select's accessible name. */
	name: string;
	effort: ReasoningEffort;
	/** The efforts the picked model accepts. */
	options: NonNullable<ModelPickerView['effortOptions']>;
	onChoose: (effort: ReasoningEffort) => void;
}

/** The effort the picked model runs at. The options are the model's own, so a value outside them never saves. */
function EffortSelect({ name, effort, options, onChoose }: EffortSelectProps) {
	function choose(value: string): void {
		const option = options.find((candidate) => candidate.value === value);

		if (option) onChoose(option.value);
	}

	return (
		<Select
			variant="quiet"
			value={effort}
			onValueChange={choose}
			options={options}
			aria-label={`${name} reasoning effort`}
			className="effort-trigger"
			contentClassName="effort-menu"
		/>
	);
}

interface ModelPickerProps {
	/** `orchestrator` runs the reviewers; `specialist` runs subagents and verifiers. */
	role: ModelRole;
	/** The role's picker state, from `useModelPicker(role)`. */
	picker: ModelPickerView;
}

/**
 * The model picker: a quiet trigger that opens the searchable model dialog,
 * with a quiet effort select beside it when the picked model has a reasoning
 * control. A pick saves at once; the row shows where that save stands.
 */
export function ModelPicker({ role, picker }: ModelPickerProps) {
	const name = ROLE_NAME[role];

	return (
		<div className="model-picker">
			<Button
				variant="quiet"
				className="model-trigger"
				disabled={!picker.canOpen}
				aria-haspopup="dialog"
				aria-expanded={picker.open}
				aria-label={picker.label ? `${name}: ${picker.label.text}` : name}
				onClick={() => picker.setOpen(true)}
			>
				<TriggerLabel picker={picker} />
				<ChevronDown aria-hidden className="model-trigger-chevron" />
			</Button>
			{picker.effort && picker.effortOptions ? (
				<EffortSelect
					name={name}
					effort={picker.effort}
					options={picker.effortOptions}
					onChoose={picker.chooseEffort}
				/>
			) : null}
			<ModelDialog
				open={picker.open}
				onOpenChange={picker.setOpen}
				role={role}
				catalog={picker.catalog}
				current={picker.current}
				onPick={picker.pickModel}
			/>
		</div>
	);
}
