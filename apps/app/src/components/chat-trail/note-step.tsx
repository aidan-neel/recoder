import type { ChatTrailNote } from '@recoder/shared';
import { ChatTextIcon } from '@phosphor-icons/react';

import { TrailStep } from './trail-step';

/** What the model said it would do next, as it said it. */
export function NoteStep({ step }: { step: ChatTrailNote }) {
	return (
		<TrailStep icon={<ChatTextIcon />} kind="note">
			<p className="trail-said">{step.text}</p>
		</TrailStep>
	);
}
