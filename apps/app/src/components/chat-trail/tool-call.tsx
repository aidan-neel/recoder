'use client';

import { isStepRunning } from '@recoder/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@recoder/ui';
import { CaretDownIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { hasDetail, opensDetail, stepSpan, toolLine, type ToolStep } from '@/lib/chat/trail';

import { FileChips } from './file-chips';
import { TrailStep } from './trail-step';

/**
 * One tool call as one line, the way Capy lists them: what it did, then how long it took. A call with more to show
 * opens under its line: the files it touched, or the command and what it printed. Only a failed command starts open;
 * a person's own open or shut wins.
 */
export function ToolCall({ step }: { step: ToolStep }) {
	const [chosen, setChosen] = useState<boolean | null>(null);

	return (
		<TrailStep kind="tool" failed={step.status === 'error'}>
			{hasDetail(step) ? (
				<Collapsible open={chosen ?? opensDetail(step)} onOpenChange={setChosen}>
					<CollapsibleTrigger className="trail-label trail-toggle">
						<ToolLabel step={step} />
						<CaretDownIcon className="trail-chevron" aria-hidden />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ToolDetail step={step} />
					</CollapsibleContent>
				</Collapsible>
			) : (
				<p className="trail-label">
					<ToolLabel step={step} />
				</p>
			)}
		</TrailStep>
	);
}

/** The verb, then the target in the code face, then a note, then how long it took. While it runs the words sweep. */
function ToolLabel({ step }: { step: ToolStep }) {
	const { verb, target, note } = toolLine(step);
	const span = stepSpan(step);

	return (
		<>
			<span className="trail-label-text" data-shimmer={isStepRunning(step) || undefined}>
				{verb}
				{target ? (
					<>
						{' '}
						<code className="trail-code">{target}</code>
					</>
				) : null}
				{note ? <span className="trail-note"> {note}</span> : null}
			</span>
			{span ? <span className="trail-time">{span}</span> : null}
		</>
	);
}

/** What opens under a call's line: the files it touched, or the command and what it printed. */
function ToolDetail({ step }: { step: ToolStep }) {
	if (step.kind !== 'run') return <FileChips files={step.files} />;

	return (
		<pre className="trail-output">
			<span className="trail-prompt">$ </span>
			{step.command}
			{step.summary ? `\n${step.summary}` : ''}
		</pre>
	);
}
