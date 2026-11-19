import { isStepRunning, type ChatTrailThought } from '@recoder/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@recoder/ui';
import { CaretDownIcon } from '@phosphor-icons/react';
import { Fragment } from 'react';

import { stepSpan, thoughtLabel } from '@/lib/chat/trail';

import { TrailStep } from './trail-step';

/** Text between single backticks is code, so a thought that names a function shows it as one. */
const CODE_SPAN = /`([^`\n]+)`/g;

/**
 * One step of the model's reasoning as one line: its title, sweeping while it goes, then how long it took. What it
 * thought opens under the line when a person asks for it.
 */
export function ThoughtStep({ step }: { step: ChatTrailThought }) {
	const label = <ThoughtLabel step={step} />;

	return (
		<TrailStep kind="thought">
			{step.text === '' ? (
				<p className="trail-label">{label}</p>
			) : (
				<Collapsible>
					<CollapsibleTrigger className="trail-label trail-toggle">
						{label}
						<CaretDownIcon className="trail-chevron" aria-hidden />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ThoughtText text={step.text} />
					</CollapsibleContent>
				</Collapsible>
			)}
		</TrailStep>
	);
}

/** `Thought for 2s`, or the provider's title followed by how long it took. */
function ThoughtLabel({ step }: { step: ChatTrailThought }) {
	const span = step.title ? stepSpan(step) : null;

	return (
		<>
			<span className="trail-label-text" data-shimmer={isStepRunning(step) || undefined}>
				{thoughtLabel(step)}
			</span>
			{span ? <span className="trail-time">{span}</span> : null}
		</>
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
