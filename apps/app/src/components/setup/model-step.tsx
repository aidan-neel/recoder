'use client';

import { useModelPicker } from '@/lib/settings/use-model-picker';
import { useReviewModel } from '@/lib/setup/use-review-model';

import { ModelPicker } from '@/components/settings/model-picker';

import { SetupStep } from './setup-step';

/** The step's line once a model is picked: the model reviews run on. Null before. */
function modelLine(done: boolean, name: string | null): string | null {
	if (!done) return null;

	return name ? `Reviews run on ${name}` : 'Reviews are set up';
}

interface ModelStepProps {
	done: boolean;
	current: boolean;
	/** A provider is in place, so there are models to pick from. */
	offered: boolean;
}

/** Step two: the model that runs the reviews, picked in place with the picker Settings uses. */
export function ModelStep({ done, current, offered }: ModelStepProps) {
	const model = useReviewModel();
	const picker = useModelPicker('orchestrator');

	return (
		<SetupStep
			name="Review model"
			detail={modelLine(done, model.name)}
			done={done}
			current={current}
			state={picker.state}
		>
			{offered ? <ModelPicker role="orchestrator" picker={picker} /> : null}
		</SetupStep>
	);
}
