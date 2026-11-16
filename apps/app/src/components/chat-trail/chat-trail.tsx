'use client';

import { isStepRunning, type ChatTrailStep } from '@recoder/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { latestLine, workedLabel, workedSeconds, workingLabel } from '@/lib/chat/trail';
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
}

/**
 * What a reply did before it answered, under one line: `Working for 8s` while it works, `Worked for 13s` once the
 * reply is done. The steps start folded; a person opens them. Each step is reasoning or a tool call, joined by one
 * thin line.
 */
export function ChatTrail({ steps, startedAt, working }: ChatTrailProps) {
	const [open, setOpen] = useState(false);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="trail" role="group" aria-label="What Recoder did">
			<CollapsibleTrigger className="trail-head">
				<TrailHead steps={steps} startedAt={startedAt} working={working} open={open} />
				<ChevronDown className="trail-chevron" aria-hidden />
			</CollapsibleTrigger>
			{working && !open ? <LatestLine steps={steps} /> : null}
			<CollapsibleContent>
				{steps.length === 0 ? null : (
					<ol className="trail-steps">
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
 * While the reply works with its steps folded, one sweeping line under the trail's line: the newest thing the model
 * said it would do, or the thought it is on. Each new one takes the place of the one before.
 */
function LatestLine({ steps }: { steps: readonly ChatTrailStep[] }) {
	const step = steps.findLast((candidate) => candidate.kind === 'note' || candidate.kind === 'thought');
	const line = step ? latestLine(step) : '';

	if (!step || !line) return null;

	return (
		<p key={step.id} className="trail-now" data-shimmer aria-live="polite">
			{line}
		</p>
	);
}

/**
 * The trail's line: `Working for 8s`, sweeping while it works, unless the steps are open and a running one shows the
 * sweep; then how long it worked.
 */
function TrailHead({ steps, startedAt, working, open }: ChatTrailProps & { open: boolean }) {
	const elapsed = useElapsedSeconds(startedAt, working);

	if (!working) return <span>{workedLabel(workedSeconds(startedAt, steps))}</span>;

	return (
		<span className="tabular" data-shimmer={open && steps.some(isStepRunning) ? undefined : true}>
			{workingLabel(elapsed)}
		</span>
	);
}
