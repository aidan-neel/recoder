import { emptyReviewProgress, reviewStage, STAGE, type Review, type ReviewProgress } from '@recoder/shared';

import { plural } from '../shell/format';
import type { RunPhase, RunStage } from './types';

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

/** The verifications that settled and that were planned. */
function verifications(progress: ReviewProgress): { settled: number; total: number } {
	const tasks = Object.values(progress.tasks).filter((task) => task.kind === 'verification');
	const waiting = new Set(['queued', 'waiting', 'running']);

	return { settled: tasks.filter((task) => !waiting.has(task.status)).length, total: tasks.length };
}

/** The count and share a step shows while it runs or once it finished. */
function measure(id: RunStage['id'], progress: ReviewProgress): Pick<RunStage, 'detail' | 'share'> {
	if (id === 'plan') {
		const claims = progress.candidateCount ?? 0;

		return { detail: claims > 0 ? plural(claims, 'claim') : null, share: null };
	}

	if (id === 'check') {
		const { settled, total } = verifications(progress);

		return total > 0 ? { detail: `${settled} of ${total}`, share: settled / total } : { detail: null, share: null };
	}

	return { detail: null, share: null };
}

/** The four steps of a review, from the pipeline's stage and the review's phase. Empty before any review. */
export function runStages(progress: ReviewProgress | null, status: Review['status'], phase: RunPhase): RunStage[] {
	if (phase === 'none') return [];

	const live = progress ?? emptyReviewProgress('');
	const current = currentStep(live, status, phase);

	return STEPS.map((step, index) => {
		const state = stateOf(index, current, phase);
		const counted = state === 'waiting' ? { detail: null, share: null } : measure(step.id, live);

		return { id: step.id, label: step.label, state, ...counted };
	});
}
