'use client';

import { prettyModelName } from '@recoder/shared';

import { ModelPicker } from '@/components/settings/model-picker';
import { rolePick } from '@/lib/settings/model-options';
import { useSettings } from '@/lib/settings/settings-store';

import { SetupStep } from './setup-step';

/** The model reviews run on, by name; null when none resolves. */
function useReviewModel(): string | null {
	const models = useSettings((state) => state.models);

	if (!models) return null;

	const pick = rolePick(models, 'orchestrator');

	if (pick.option) return pick.option.name;

	const id = pick.id ?? models.model;

	return id ? prettyModelName(id) : null;
}

/** Step two: the model that runs the reviewers, picked right here with the same picker Settings uses. */
export function ModelStep({ done, current }: { done: boolean; current: boolean }) {
	const name = useReviewModel();

	const description = done
		? name
			? `Reviews run on ${name}`
			: 'Reviews are set up'
		: 'Reviews won’t start without one.';

	return (
		<SetupStep done={done} current={current} title="Pick a model" description={description}>
			<div className="setup-model">
				<span className="setup-model-label">Review model</span>
				<ModelPicker role="orchestrator" />
			</div>
		</SetupStep>
	);
}
