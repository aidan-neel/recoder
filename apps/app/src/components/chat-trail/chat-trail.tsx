'use client';

import { isStepRunning, type ChatTrailStep } from '@recoder/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, SwapText } from '@recoder/ui';
import { CaretDownIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { workedLabel, workedSeconds, workingLabel } from '@/lib/chat/trail';
import { useElapsedSeconds } from '@/lib/chat/use-elapsed';

import { NoteStep } from './note-step';
import { ThoughtStep } from './thought-step';
import { ToolCall } from './tool-call';

interface ChatTrailProps {
	steps: readonly ChatTrailStep[];
	/** When the reply began, ISO. */
	startedAt: string | null;
	/** True until the reply is done: a model may write between its tool calls, so text does not end the work. */
	working: boolean;
	/** True once the answer has begun: the steps fold away under the line so the answer reads from the top. */
	answering: boolean;
}

/**
 * What a reply did before it answered, the way a Capy thread shows it: one line across the column, `Working for 8s`
 * while it works and `Worked for 13s` once it is done, with the steps under it. The steps arrive live, one line each,
 * while the reply works, and fold away under the line once the answer begins. A person who opens or shuts them
 * keeps that choice.
 */
export function ChatTrail({ steps, startedAt, working, answering }: ChatTrailProps) {
	const [chosen, setChosen] = useState<boolean | null>(null);
	const open = chosen ?? (working && !answering);

	return (
		<Collapsible open={open} onOpenChange={setChosen} className="trail" role="group" aria-label="What Recoder did">
			<CollapsibleTrigger className="trail-head">
				<TrailHead steps={steps} startedAt={startedAt} working={working} open={open} />
				<CaretDownIcon className="trail-chevron" aria-hidden />
			</CollapsibleTrigger>
			<CollapsibleContent>
				{steps.length === 0 ? null : (
					<ol className="trail-steps" aria-live={working ? 'polite' : undefined}>
						{steps.map((step) => (
							<TrailStepView key={step.id} step={step} />
						))}
					</ol>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

function TrailStepView({ step }: { step: ChatTrailStep }) {
	if (step.kind === 'thought') return <ThoughtStep step={step} />;
	if (step.kind === 'note') return <NoteStep step={step} />;

	return <ToolCall step={step} />;
}

/**
 * The trail's line: `Working for 8s`, sweeping while it works, unless the steps are open and a running one shows the
 * sweep; then how long it worked.
 */
function TrailHead({ steps, startedAt, working, open }: Omit<ChatTrailProps, 'answering'> & { open: boolean }) {
	const elapsed = useElapsedSeconds(startedAt, working);

	const label = working ? (
		<span className="tabular" data-shimmer={open && steps.some(isStepRunning) ? undefined : true}>
			{workingLabel(elapsed)}
		</span>
	) : (
		<span className="tabular">{workedLabel(workedSeconds(startedAt, steps))}</span>
	);

	return <SwapText id={working ? 'working' : 'worked'}>{label}</SwapText>;
}
