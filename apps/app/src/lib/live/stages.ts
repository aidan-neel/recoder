import { reviewStage, STAGE, type Review, type ReviewProgress, type ReviewStage } from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

import { plural } from '../shell/format';
import type { LivePhase } from './live-progress';
import { isSubagent, reviewerHeadline } from './reviewers';

/** How one stage stands: not reached, running, held or finished. */
export type StageState = 'idle' | 'active' | 'paused' | 'done';

export interface StageRow {
	key: ReviewStage;
	label: string;
	state: StageState;
	glyph: GlyphKind;
}

/** The pipeline's stages in order, without the `done` marker. */
const STAGE_KEYS = (Object.keys(STAGE) as (keyof typeof STAGE)[])
	.filter((key): key is ReviewStage => key !== 'done')
	.sort((a, b) => STAGE[a] - STAGE[b]);

/** Each stage as the timeline names it: a short noun, since the row's glyph says whether it runs. */
const STAGE_LABEL: Record<ReviewStage, string> = {
	checkout: 'Checkout',
	understand: 'Understand',
	checks: 'Checks',
	reviewing: 'Review',
	subagents: 'Subagents',
	verify: 'Verify',
	consolidation: 'Finish'
};

/** What a stage does, for a stage that has not run yet or left nothing to report. */
const STAGE_ABOUT: Record<ReviewStage, string> = {
	checkout: 'The head commit, in a clean sandbox',
	understand: 'Read the change and plan the reviewers',
	checks: 'Install dependencies and run the checks',
	reviewing: 'Reviewers each read a slice of the change with every lens',
	subagents: 'Narrow follow-ups a reviewer handed off',
	verify: 'Each possible issue is checked before it shows',
	consolidation: 'The summary and the final list of findings'
};

const GLYPH: Record<StageState, GlyphKind> = {
	idle: 'idle',
	active: 'spinner',
	paused: 'idle',
	done: 'ok'
};

/** The running stage's index, or -1 before the pipeline starts. */
function currentIndex(progress: ReviewProgress, phase: LivePhase, status: Review['status']): number {
	if (phase === 'draft' || phase === 'queued') return -1;

	return reviewStage(progress, status).index;
}

function stateAt(index: number, current: number, phase: LivePhase): StageState {
	if (index < current) return 'done';
	if (index > current) return 'idle';

	return phase === 'paused' ? 'paused' : 'active';
}

/**
 * The stages to list, each with its state. The subagents stage shows only
 * once a reviewer asked for one or the pipeline reached it, since most
 * reviews never run any.
 */
export function stageRows(progress: ReviewProgress, phase: LivePhase, status: Review['status']): StageRow[] {
	const current = currentIndex(progress, phase, status);
	const subagents = (progress.assignments ?? []).some(isSubagent);

	return STAGE_KEYS.filter((key) => key !== 'subagents' || subagents || current === STAGE.subagents).map((key) => {
		const state = stateAt(STAGE[key], current, phase);

		return { key, label: STAGE_LABEL[key], state, glyph: GLYPH[state] };
	});
}

/** True while the stage is the one the review is in, running or held. */
export function isCurrent(row: StageRow): boolean {
	return row.state === 'active' || row.state === 'paused';
}

/** "Step 3 of 6": the current stage's place among the listed ones; null before the pipeline starts. */
export function stageStep(rows: StageRow[]): { step: number; total: number } | null {
	const index = rows.findIndex(isCurrent);

	return index < 0 ? null : { step: index + 1, total: rows.length };
}

/**
 * The line under the running stage: the stage's own step while it checks
 * out or runs checks, otherwise the latest thing the pipeline did.
 */
function stageDetail(progress: ReviewProgress, status: Review['status']): string | null {
	const own = reviewStage(progress, status).detail;

	return own || progress.activity.at(-1)?.message || null;
}

/** The first of these tasks the review has, by its message. */
function taskMessage(progress: ReviewProgress, ids: string[]): string | null {
	return ids.map((id) => progress.tasks[id]?.message).find(Boolean) ?? null;
}

/** "2 of 3 possible issues checked", once a verifier has started on one. */
function verifyNote(progress: ReviewProgress): string | null {
	const tasks = Object.values(progress.tasks).filter((task) => task.kind === 'verification');

	const settled = tasks.filter(
		(task) => task.status !== 'running' && task.status !== 'waiting' && task.status !== 'queued'
	);

	if (tasks.length === 0) return null;

	return `${settled.length} of ${plural(tasks.length, 'possible issue')} checked`;
}

/** What a finished stage left behind: the message of the task that closed it. */
function doneNote(key: ReviewStage, progress: ReviewProgress): string | null {
	switch (key) {
		case 'checkout':
			return taskMessage(progress, ['diff', 'sandbox', 'fetch']);

		case 'understand':
			return taskMessage(progress, ['inventory']);

		case 'checks':
			return taskMessage(progress, ['checks', 'setup']);

		case 'verify':
			return verifyNote(progress);

		default:
			return taskMessage(progress, ['finalize']);
	}
}

/** Before Verify runs: how many possible issues wait for it, once reviewers raised any. */
function verifyAhead(progress: ReviewProgress): string | null {
	const count = progress.candidateCount ?? 0;

	return count > 0 ? `${plural(count, 'possible issue')} to check` : null;
}

/**
 * The second line of a stage on the timeline. Review and Subagents count
 * their reviewers in any state; the running stage says what it is doing; a
 * finished one what it left behind; one not reached yet what it will do.
 */
export function stageNote(row: StageRow, progress: ReviewProgress, status: Review['status']): string {
	if (row.key === 'reviewing' || row.key === 'subagents') {
		const assignments = (progress.assignments ?? []).filter((item) => isSubagent(item) === (row.key === 'subagents'));

		return reviewerHeadline(assignments) ?? STAGE_ABOUT[row.key];
	}

	if (row.state === 'idle') return (row.key === 'verify' && verifyAhead(progress)) || STAGE_ABOUT[row.key];

	if (row.state === 'done') return doneNote(row.key, progress) ?? STAGE_ABOUT[row.key];

	if (row.key === 'verify') return verifyNote(progress) ?? stageDetail(progress, status) ?? STAGE_ABOUT.verify;

	return stageDetail(progress, status) ?? STAGE_ABOUT[row.key];
}
