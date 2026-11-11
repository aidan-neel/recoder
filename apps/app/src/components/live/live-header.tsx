'use client';

import type { Review } from '@recoder/shared';
import { AnimatedNumber, Button, Keycap, Meter, swapMotion, useMotionVariants } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { takeFocus } from '@/lib/live/focus-handoff';
import { connectionNote, progressShare, type LivePhase } from '@/lib/live/live-progress';
import { stageRows, stageStep } from '@/lib/live/stages';
import { useReview } from '@/lib/review/review-store';

import { LiveControls } from './live-controls';
import { SmoothHeight } from './smooth-height';

/** The old app's line under the lead while reviewers work. */
const WAITING = 'Decisions appear here as reviewers confirm them; you can start before it finishes.';

/** The running lead, the longest of them. */
const REVIEWING = 'Reviewing this pull request.';

const LEAD: Record<LivePhase, { lead: ReactNode; rest?: string }> = {
	queued: { lead: 'Waiting for a free slot.', rest: WAITING },
	running: {
		lead: <span className="shimmer-text">{REVIEWING}</span>,
		rest: WAITING
	},
	paused: { lead: 'Paused.', rest: 'Model calls wait until you resume.' },
	draft: { lead: 'Talk it through first, or start the review.' }
};

/** The lead in the AI voice, and under it the line that says what happens next. */
function Lead({ lead, rest, as: Tag = 'p' }: { lead: ReactNode; rest?: string; as?: 'p' | 'h2' }) {
	return (
		<div className="live-lead-text">
			<Tag className="ai-voice live-lead-title">{lead}</Tag>
			{rest ? <p className="ai-voice live-lead-rest">{rest}</p> : null}
		</div>
	);
}

/** The live stream's state, shown only while it is not connected. */
function ConnectionNote() {
	const connection = useReview((state) => state.connection);
	const note = connectionNote(connection);

	return (
		<span role="status" className="live-connection" data-state={connection}>
			{note ? (
				<>
					<span aria-hidden className="live-connection-dot" />
					<span className="min-w-0 truncate">{note}</span>
				</>
			) : null}
		</span>
	);
}

/** The meter fills as steps finish, slides until the plan is known and rests empty while queued; it turns amber while paused. */
function ProgressMeter({ phase }: { phase: LivePhase }) {
	const progress = useReview((state) => state.progress);

	return (
		<Meter
			value={progressShare(progress, phase)}
			tone={phase === 'paused' ? 'medium' : 'neutral'}
			aria-label="Review progress"
			className="live-meter"
		/>
	);
}

/** "Step 3 of 6": the current stage's place on the timeline, its number rolling as the review moves on. */
function StepNote({ review, phase }: { review: Review; phase: LivePhase }) {
	const progress = useReview((state) => state.progress);
	const step = progress ? stageStep(stageRows(progress, phase, review.status)) : null;

	if (!step) return null;

	return (
		<span className="live-note">
			Step <AnimatedNumber value={step.step} /> of <AnimatedNumber value={step.total} />
		</span>
	);
}

/** Opens the ask column on the conversation with Orchestrator; hidden while the column is open. */
function AskOrchestrator() {
	const open = useReview((state) => state.askOpen);

	if (open) return null;

	return (
		<Button variant="quiet" aria-keyshortcuts="Q" onClick={() => useReview.getState().setAskOpen(true)}>
			Ask Orchestrator <Keycap k="q" />
		</Button>
	);
}

/**
 * The serif lead for where the review stands: the old one fades out, then
 * the new one in. Past the draft, the running lead sits unseen under it, so
 * the box keeps one height and Pause does not move under the pointer when it
 * turns to Resume. Then the meter, the step, the connection, the way to
 * Orchestrator and the controls. A draft leads with Start review, so the
 * filled button lines up with the lead. A control that left as the review
 * moved on (Start review, the notice's Continue) hands focus here: to Pause
 * when it shows, else to the header.
 */
export function LiveHeader({ review, phase }: { review: Review; phase: LivePhase }) {
	const swap = useMotionVariants(swapMotion);
	const { lead, rest } = LEAD[phase];
	const header = useRef<HTMLElement>(null);

	useLayoutEffect(() => {
		const element = header.current;

		takeFocus('live', element?.querySelector<HTMLElement>('.live-toggle') ?? element);
	}, [phase]);

	return (
		<header ref={header} tabIndex={-1} data-ui="live-header" className="live-header">
			<SmoothHeight>
				<div className="live-lead">
					{phase === 'draft' ? null : (
						<div aria-hidden className="live-lead-sizer">
							<Lead lead={REVIEWING} rest={WAITING} />
						</div>
					)}
					<AnimatePresence initial={false} mode="wait">
						<motion.div key={phase} variants={swap} initial="initial" animate="animate" exit="exit">
							<Lead as="h2" lead={lead} rest={rest} />
						</motion.div>
					</AnimatePresence>
				</div>
			</SmoothHeight>
			{phase === 'draft' ? null : <ProgressMeter phase={phase} />}
			<div className="live-actions">
				{phase === 'draft' ? null : (
					<>
						<StepNote review={review} phase={phase} />
						<ConnectionNote />
						<span className="flex-1" />
					</>
				)}
				{phase === 'draft' ? null : <AskOrchestrator />}
				<LiveControls review={review} phase={phase} />
				{phase === 'draft' ? <AskOrchestrator /> : null}
			</div>
		</header>
	);
}
