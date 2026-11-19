'use client';

import type { SetupStep as Step } from '@recoder/shared';
import { useEffect } from 'react';

import { useModelPicker } from '@/lib/settings/use-model-picker';
import { useChecklist } from '@/lib/setup/checklist-store';

import { ModelPicker } from '@/components/settings/model-picker';

import { SetupStep } from './setup-step';

/** Step five: the model that runs the reviews, picked in place with the picker Settings uses. */
export function ModelStep({ step, current }: { step: Step; current: boolean }) {
	const picker = useModelPicker('orchestrator');

	useEffect(() => {
		if (picker.state === 'success') void useChecklist.getState().load();
	}, [picker.state]);

	return (
		<SetupStep
			name="Review model"
			step={step}
			current={current}
			hint="Grok 4.6 at Low effort is the default"
			state={picker.state}
		>
			{current || step.done ? <ModelPicker role="orchestrator" picker={picker} /> : null}
		</SetupStep>
	);
}
