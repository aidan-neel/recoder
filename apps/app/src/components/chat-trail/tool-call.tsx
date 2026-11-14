'use client';

import { isStepRunning } from '@recoder/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Spinner } from '@recoder/ui';
import { ChevronDown, FileText, Search, SquareTerminal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { hasDetail, opensDetail, toolLine, type ToolStep } from '@/lib/chat/trail';

import { FileChips } from './file-chips';
import { TrailStep } from './trail-step';

/**
 * One tool call as a step. A call with more to show opens under its label: the files a search or a read found start
 * open, a command's output only once it failed. A person's own open or shut wins.
 */
export function ToolCall({ step }: { step: ToolStep }) {
	const [chosen, setChosen] = useState<boolean | null>(null);
	const failed = step.status === 'error';

	return (
		<TrailStep icon={<ToolIcon step={step} />} kind="tool" failed={failed}>
			{hasDetail(step) ? (
				<Collapsible open={chosen ?? opensDetail(step)} onOpenChange={setChosen}>
					<CollapsibleTrigger className="trail-label trail-toggle">
						<ToolLabel step={step} />
						<ChevronDown className="trail-chevron" aria-hidden />
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

/** The verb, then the target in the code face, then a note. While it runs the words sweep. */
function ToolLabel({ step }: { step: ToolStep }) {
	const { verb, target, note } = toolLine(step);

	return (
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
	);
}

/** A tool's icon, a spinner while it runs, and the failure mark when it failed. */
function ToolIcon({ step }: { step: ToolStep }) {
	if (step.status === 'error') return <TriangleAlert />;
	if (isStepRunning(step)) return <Spinner />;
	if (step.kind === 'search') return <Search />;
	if (step.kind === 'read') return <FileText />;

	return <SquareTerminal />;
}

/** What opens under a call's label: the files it touched, or the command and what it printed. */
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
