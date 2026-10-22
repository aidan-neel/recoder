import {
	emptyReviewProgress,
	reviewStage,
	STAGE,
	type Review,
	type ReviewProgress,
	type ReviewStage
} from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

import type { LivePhase } from './live-progress';

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

/**
 * Each stage's label, read through the shared `reviewStage` (which names
 * only the running stage) so both apps call every stage the same.
 */
const STAGE_LABEL = Object.fromEntries(
	STAGE_KEYS.map((key) => [key, reviewStage({ ...emptyReviewProgress(''), stage: key }, 'running').label])
) as Record<ReviewStage, string>;

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
	const subagents = (progress.assignments ?? []).some((assignment) => assignment.role === 'subagent');

	return STAGE_KEYS.filter((key) => key !== 'subagents' || subagents || current === STAGE.subagents).map((key) => {
		const state = stateAt(STAGE[key], current, phase);

		return { key, label: STAGE_LABEL[key], state, glyph: GLYPH[state] };
	});
}

/**
 * The line under the running stage: the stage's own step while it checks
 * out or runs checks, otherwise the latest thing the pipeline did.
 */
export function stageDetail(progress: ReviewProgress, status: Review['status']): string | null {
	const own = reviewStage(progress, status).detail;

	return own || progress.activity.at(-1)?.message || null;
}
