'use client';

import { isStepRunning, type ChatTrailStep } from '@recoder/shared';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	DURATION,
	EASE_OUT,
	swapMotion,
	SwapText,
	useMotionVariants
} from '@recoder/ui';
import { CaretDownIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
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
	/** True once the answer has begun: it takes the place of the line that says what the model is on. */
	answering: boolean;
}

/**
 * What a reply did before it answered, under one line: `Working for 8s` while it works, `Worked for 13s` once the
 * reply is done. The steps start folded; a person opens them. Each step is reasoning or a tool call, joined by one
 * thin line. While it works with the steps folded, the newest thought sits under that line until the answer begins
 * and fades out in the place where the answer's first line fades in.
 */
export function ChatTrail({ steps, startedAt, working, answering }: ChatTrailProps) {
	const [open, setOpen] = useState(false);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="trail" role="group" aria-label="What Recoder did">
			<CollapsibleTrigger className="trail-head">
				<TrailHead steps={steps} startedAt={startedAt} working={working} open={open} />
				<CaretDownIcon className="trail-chevron" aria-hidden />
			</CollapsibleTrigger>
			<LatestLine steps={steps} shown={working && !open && !answering} />
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
 * The live line comes in as a swap does, and leaves in place, slower than it came: it fades for as long as the
 * answer's first words take to arrive in its place, so the two cross rather than leave a blank line between them.
 */
const LINE_MOTION: Variants = {
	...swapMotion,
	exit: { opacity: 0, transition: { duration: DURATION.disclose, ease: EASE_OUT } }
};

/**
 * One sweeping line under the trail's line: the newest thing the model said it would do, or the thought it is on.
 * Each new one crossfades in the place of the one before; a line that goes leaves the layout at once and fades where
 * it stood, so what follows (the answer) moves into its place under it.
 */
function LatestLine({ steps, shown }: { steps: readonly ChatTrailStep[]; shown: boolean }) {
	const variants = useMotionVariants(LINE_MOTION);
	const step = steps.findLast((candidate) => candidate.kind === 'note' || candidate.kind === 'thought');
	const line = step ? latestLine(step) : '';

	return (
		<AnimatePresence mode="popLayout" initial={false}>
			{shown && step && line ? (
				<motion.p
					key={step.id}
					className="trail-now"
					data-shimmer
					aria-live="polite"
					variants={variants}
					initial="initial"
					animate="animate"
					exit="exit"
				>
					{line}
				</motion.p>
			) : null}
		</AnimatePresence>
	);
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
