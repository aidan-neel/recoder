import type { ReviewAssignment } from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

import { plain } from '../review/labels';
import type { LivePhase } from './live-progress';

export interface ReviewerRow {
	id: string;
	/** What the reviewer looks at: its lens and files, or the question a subagent follows. */
	name: string;
	/** What it is doing now, or how it ended. */
	step: string;
	glyph: GlyphKind;
	/** Its state in words, for assistive tech. */
	state: string;
}

const STATE_WORD: Record<ReviewAssignment['status'], string> = {
	running: 'Reviewing',
	waiting: 'Waiting for a model',
	queued: 'Queued',
	done: 'Finished',
	error: 'Failed',
	skipped: 'Not run'
};

/** A running reviewer spins only while the review runs; paused or waiting for a slot, it rests. */
function glyphFor(status: ReviewAssignment['status'], phase: LivePhase): GlyphKind {
	if (status === 'running') return phase === 'running' ? 'spinner' : 'idle';
	if (status === 'done') return 'ok';
	if (status === 'error') return 'failed';
	if (status === 'skipped') return 'dismissed';

	return 'idle';
}

/** Legacy snapshots can carry a `partial` reviewer, which meant finished. */
function normalStatus(assignment: ReviewAssignment): ReviewAssignment['status'] {
	return (assignment.status as string) === 'partial' ? 'done' : assignment.status;
}

/**
 * The reviewers in plan order, one row per id (the latest copy wins: older
 * snapshots can repeat an id). Each row says what the reviewer covers and
 * what it is doing.
 */
export function reviewerRows(assignments: ReviewAssignment[] | undefined, phase: LivePhase): ReviewerRow[] {
	const latest = new Map((assignments ?? []).map((assignment) => [assignment.id, assignment]));

	return [...latest.values()].map((assignment) => {
		const status = normalStatus(assignment);

		return {
			id: assignment.id,
			name: plain(assignment.title || assignment.role),
			step: plain(assignment.currentOperation || STATE_WORD[status]),
			glyph: glyphFor(status, phase),
			state: STATE_WORD[status]
		};
	});
}

/** Reviewers that ended (finished, failed or not run) of all assigned. */
export function reviewerTally(rows: ReviewerRow[]): { ended: number; total: number } {
	const ended = rows.filter((row) => row.glyph === 'ok' || row.glyph === 'failed' || row.glyph === 'dismissed').length;

	return { ended, total: rows.length };
}
