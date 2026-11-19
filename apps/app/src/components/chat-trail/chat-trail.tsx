'use client';

import { type ChatTrailStep } from '@recoder/shared';
import { AnimatedNumber, Collapsible, CollapsibleContent, CollapsibleTrigger, SwapText } from '@recoder/ui';
import { useState } from 'react';

import { spanLabel, workedLabel, workedSeconds } from '@/lib/chat/trail';
import { useElapsedSeconds } from '@/lib/chat/use-elapsed';

import { NoteStep } from './note-step';
import { ThoughtStep } from './thought-step';
import { ToolCall } from './tool-call';

interface ChatTrailProps {
	steps: readonly ChatTrailStep[];
	/** When the reply began, ISO. */
	startedAt: string | null;
	/** When the reply ended, ISO; null while it works or when it was saved without one. */
	endedAt: string | null;
	/** True until the reply is done: a model may write between its tool calls, so text does not end the work. */
	working: boolean;
}

/**
 * What a reply did, the way a Capy thread shows it: one centred line, `Working for 8s` while it works and
 * `Worked for 13s` once it is done, the same line from send to done so nothing around it moves. The steps sit folded
 * under it, live while the reply works; pressing the line opens them, and the person's choice stays. Until a step
 * arrives the line opens nothing, but it is the same line, so the sweep never restarts.
 */
export function ChatTrail({ steps, startedAt, endedAt, working }: ChatTrailProps) {
	const [open, setOpen] = useState(false);
	const empty = steps.length === 0;

	return (
		<Collapsible
			open={open && !empty}
			onOpenChange={setOpen}
			className="trail"
			role="group"
			aria-label="What Recoder did"
		>
			<CollapsibleTrigger className="trail-head" disabled={empty}>
				<TrailHead steps={steps} startedAt={startedAt} endedAt={endedAt} working={working} />
			</CollapsibleTrigger>
			<CollapsibleContent>
				{empty ? null : (
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

/** The trail's line: `Working for 8s`, its seconds rolling like Capy's and the line sweeping, then how long it worked. */
function TrailHead({ steps, startedAt, endedAt, working }: ChatTrailProps) {
	const elapsed = useElapsedSeconds(startedAt, working);

	const label = working ? (
		<span className="tabular" data-shimmer>
			{elapsed === null ? (
				'Working'
			) : (
				<>
					Working for <AnimatedNumber value={elapsed} format={spanLabel} />
				</>
			)}
		</span>
	) : (
		<span className="tabular">{workedLabel(workedSeconds(startedAt, endedAt, steps))}</span>
	);

	return <SwapText id={working ? 'working' : 'worked'}>{label}</SwapText>;
}
