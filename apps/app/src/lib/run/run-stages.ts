import {
	emptyReviewProgress,
	reviewStage,
	STAGE,
	type Review,
	type ReviewProgress,
	type ReviewTaskKind
} from '@recoder/shared';

import { formatDuration, plural } from '../shell/format';
import { claimLines, partLines, verificationTasks } from './run-lines';
import type { RunFact, RunPhase, RunStage } from './types';

/** The four steps a person sees, each standing for the pipeline stages up to its `last` (an index of `STAGE`). */
const STEPS: { id: RunStage['id']; label: string; last: number }[] = [
	{ id: 'read', label: 'Read the change', last: STAGE.understand },
	{ id: 'plan', label: 'Find what to check', last: STAGE.subagents },
	{ id: 'check', label: 'Check each claim', last: STAGE.verify },
	{ id: 'write', label: 'Write the summary', last: STAGE.consolidation }
];

/** Which step the pipeline stage index falls in; `STEPS.length` once the review is done. */
function stepOf(index: number): number {
	const step = STEPS.findIndex((candidate) => index <= candidate.last);

	return step === -1 ? STEPS.length : step;
}

/** The step the review is on: none before it starts, past the last once it passed. */
function currentStep(progress: ReviewProgress, status: Review['status'], phase: RunPhase): number {
	if (phase === 'queued' || phase === 'none') return -1;
	if (phase === 'passed') return STEPS.length;

	return stepOf(reviewStage(progress, status).index);
}

/** How a step stands. A failed or stopped review leaves the step it was on waiting, not active. */
function stateOf(step: number, current: number, phase: RunPhase): RunStage['state'] {
	if (step < current) return 'done';
	if (step > current) return 'waiting';

	return phase === 'running' || phase === 'paused' ? 'active' : 'waiting';
}

/** The tasks that make up each step, by kind; their times give the step's duration. */
const STEP_KINDS: Record<RunStage['id'], ReviewTaskKind[]> = {
	read: ['checkout', 'inventory'],
	plan: ['planning', 'assignment'],
	check: ['verification'],
	write: ['consolidation']
};

/** How long a step's own tasks ran, from the first start to the last change; null when none says when it began. */
function took(id: RunStage['id'], progress: ReviewProgress): RunFact | null {
	const tasks = Object.values(progress.tasks).filter((task) => task.kind && STEP_KINDS[id].includes(task.kind));
	const starts = tasks.flatMap((task) => (task.startedAt ? [Date.parse(task.startedAt)] : []));
	const ends = tasks.flatMap((task) => (task.updatedAt ? [Date.parse(task.updatedAt)] : []));

	if (!starts.length || !ends.length) return null;

	return fact(formatDuration(Math.max(...ends) - Math.min(...starts)), 'neutral', 'time');
}

function fact(text: string, tone: RunFact['tone'] = 'neutral', kind: RunFact['kind'] = 'text'): RunFact {
	return { text, tone, kind };
}

/** The guidelines the review read: the repository's file by its path, the owner's own as words. */
function guidelineFacts(progress: ReviewProgress): RunFact[] {
	return (progress.guidelines?.layers ?? []).map((layer) =>
		layer.source === 'repo' ? fact(layer.path ?? 'RECODER.md', 'neutral', 'code') : fact('Your guidelines')
	);
}

/** Whether a task or a part has finished, however it ended. */
function finished(status: string): boolean {
	return !['queued', 'waiting', 'running'].includes(status);
}

type StepWork = Pick<RunStage, 'share' | 'facts' | 'lines' | 'rest'>;

const NO_WORK: StepWork = { share: null, facts: [], lines: [], rest: null };

/** The plan: the claims its reviewers raised and how many read the change; while it runs, how many parts are done. */
function planWork(progress: ReviewProgress, active: boolean): StepWork {
	const parts = progress.assignments ?? [];
	const claims = progress.candidateCount ?? 0;
	const done = parts.filter((part) => finished(part.status)).length;

	return {
		share: active && parts.length ? done / parts.length : null,
		facts: [
			...(claims ? [fact(plural(claims, 'claim'), active ? 'progress' : 'neutral')] : []),
			...(parts.length ? [fact(plural(parts.length, 'reviewer'))] : [])
		],
		lines: partLines(progress),
		rest: null
	};
}

/** The check: claims settled of all and verifiers at work while it runs, and what it found; the plan already counts the claims. */
function checkWork(progress: ReviewProgress, active: boolean): StepWork {
	const tasks = verificationTasks(progress);
	const settled = tasks.filter((task) => finished(task.status)).length;
	const working = tasks.filter((task) => task.status === 'running').length;
	const { lines, rest, found } = claimLines(progress);
	const foundFact = found ? [fact(active ? `${found} found so far` : `${found} found`, 'found')] : [];

	if (!active) return { share: null, facts: foundFact, lines, rest };

	return {
		share: tasks.length ? settled / tasks.length : null,
		facts: [
			...(tasks.length ? [fact(`${settled} of ${tasks.length}`, 'progress')] : []),
			...(working ? [fact(`${working} at work`)] : []),
			...foundFact
		],
		lines,
		rest
	};
}

/** What each step makes or is making, from the progress. */
const WORK: Record<RunStage['id'], (progress: ReviewProgress, active: boolean) => StepWork> = {
	read: (progress) => ({ ...NO_WORK, facts: guidelineFacts(progress) }),
	plan: planWork,
	check: checkWork,
	write: () => NO_WORK
};

/** What a step made or is making. A waiting step has nothing yet; a done one adds how long it took. */
function workOf(id: RunStage['id'], state: RunStage['state'], progress: ReviewProgress): StepWork {
	if (state === 'waiting') return NO_WORK;

	const work = WORK[id](progress, state === 'active');
	const time = state === 'done' ? took(id, progress) : null;

	return time ? { ...work, facts: [...work.facts, time] } : work;
}

/** The four steps of a review, from the pipeline's stage and the review's phase. Empty before any review. */
export function runStages(progress: ReviewProgress | null, status: Review['status'], phase: RunPhase): RunStage[] {
	if (phase === 'none') return [];

	const live = progress ?? emptyReviewProgress('');
	const current = currentStep(live, status, phase);

	return STEPS.map((step, index) => {
		const state = stateOf(index, current, phase);
		const work = workOf(step.id, state, live);
		const paused = phase === 'paused' && state === 'active';

		return {
			id: step.id,
			label: step.label,
			state,
			...work,
			facts: paused ? [fact('Paused'), ...work.facts] : work.facts
		};
	});
}
