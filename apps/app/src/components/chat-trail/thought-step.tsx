import { isStepRunning, type ChatTrailThought } from '@recoder/shared';
import { Lightbulb } from 'lucide-react';
import { Fragment } from 'react';

import { thoughtLabel } from '@/lib/chat/trail';

import { TrailStep } from './trail-step';

/** Text between single backticks is code, so a thought that names a function shows it as one. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** One step of the model's reasoning: its title as the label, sweeping while it goes, and its text under it. */
export function ThoughtStep({ step }: { step: ChatTrailThought }) {
	return (
		<TrailStep icon={<Lightbulb />} kind="thought">
			<p className="trail-label">
				<span data-shimmer={isStepRunning(step) || undefined}>{thoughtLabel(step)}</span>
			</p>
			{step.text === '' ? null : <ThoughtText text={step.text} />}
		</TrailStep>
	);
}

/** A thought's text as a paragraph: backtick spans in the code face, the rest plain. */
function ThoughtText({ text }: { text: string }) {
	const parts = text.split(CODE_SPAN);

	return (
		<p className="trail-text">
			{parts.map((part, index) =>
				index % 2 === 1 ? (
					<code key={index} className="trail-code">
						{part}
					</code>
				) : (
					<Fragment key={index}>{part}</Fragment>
				)
			)}
		</p>
	);
}
