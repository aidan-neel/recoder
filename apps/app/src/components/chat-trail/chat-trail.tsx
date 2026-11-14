'use client';

import { isStepRunning, type ChatTrailStep } from '@recoder/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { spanLabel, workedLabel, workedSeconds } from '@/lib/chat/trail';
import { useElapsedSeconds } from '@/lib/chat/use-elapsed';

import { ThoughtStep } from './thought-step';
import { ToolCall } from './tool-call';

interface ChatTrailProps {
	steps: readonly ChatTrailStep[];
	/** When the reply began, ISO. */
	startedAt: string | null;
	/** True until the answer starts. */
	working: boolean;
}

/**
 * What a reply did before it answered, under one line: `Thinking 8s` while it works, `Worked for 13s` once the
 * answer starts. The steps start folded; a person opens them. Each step is reasoning or a tool call, joined by one
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
			<CollapsibleContent>
				{steps.length === 0 ? null : (
					<ol className="trail-steps">
						{steps.map((step) =>
							step.kind === 'thought' ? (
								<ThoughtStep key={step.id} step={step} />
							) : (
								<ToolCall key={step.id} step={step} />
							)
						)}
					</ol>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * The trail's line: `Thinking` and the seconds so far, sweeping while it works, unless the steps are open and a
 * running one shows the sweep; then how long it worked.
 */
function TrailHead({ steps, startedAt, working, open }: ChatTrailProps & { open: boolean }) {
	const elapsed = useElapsedSeconds(startedAt, working);

	if (!working) return <span>{workedLabel(workedSeconds(startedAt, steps))}</span>;

	return (
		<>
			<span data-shimmer={open && steps.some(isStepRunning) ? undefined : true}>Thinking</span>
			{elapsed !== null && elapsed >= 1 ? <span className="trail-seconds tabular">{spanLabel(elapsed)}</span> : null}
		</>
	);
}
