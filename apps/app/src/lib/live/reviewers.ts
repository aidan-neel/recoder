import type { ReviewAssignment, ReviewToolCall } from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

import { plain } from '../review/labels';
import type { LivePhase } from './live-progress';

export interface ReviewerRow {
	id: string;
	/** What the reviewer looks at: its number and files, or the question a subagent follows. */
	name: string;
	/** What it is doing now, or how it ended. */
	step: string;
	/** True when `step` is a command the reviewer is running, set in the code face. */
	command: boolean;
	/** Possible issues it raised so far. */
	found: number;
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

/** True for a follow-up a reviewer handed off, which the timeline lists under Subagents. */
export function isSubagent(assignment: ReviewAssignment): boolean {
	return assignment.role === 'subagent';
}

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

/** One row per id, in plan order; the latest copy wins, since older snapshots can repeat an id. */
function latest(assignments: ReviewAssignment[] | undefined): ReviewAssignment[] {
	return [...new Map((assignments ?? []).map((assignment) => [assignment.id, assignment])).values()];
}

/** The command each reviewer is running right now, by reviewer id: its latest tool call still running. */
function runningCommands(toolCalls: ReviewToolCall[] | undefined): Map<string, string> {
	const commands = new Map<string, string>();

	for (const tool of toolCalls ?? []) {
		if (tool.status === 'running' && tool.assignmentId) commands.set(tool.assignmentId, tool.command);
	}

	return commands;
}

/**
 * The reviewers in plan order. Each row says what the reviewer covers, what
 * it is doing (the command it runs while one runs) and how many possible
 * issues it raised.
 */
export function reviewerRows(
	assignments: ReviewAssignment[] | undefined,
	phase: LivePhase,
	toolCalls?: ReviewToolCall[]
): ReviewerRow[] {
	const commands = runningCommands(toolCalls);

	return latest(assignments).map((assignment) => {
		const status = normalStatus(assignment);
		const command = status === 'running' ? commands.get(assignment.id) : undefined;

		return {
			id: assignment.id,
			name: plain(assignment.title || assignment.role),
			step: command ?? plain(assignment.currentOperation || STATE_WORD[status]),
			command: command !== undefined,
			found: assignment.candidateCount ?? 0,
			glyph: glyphFor(status, phase),
			state: STATE_WORD[status]
		};
	});
}

/** The phrases of a reviewer headline, in the order they read. */
const HEADLINE: [ReviewAssignment['status'], string][] = [
	['running', 'working'],
	['waiting', 'waiting for a model'],
	['done', 'finished'],
	['error', 'failed'],
	['skipped', 'not run'],
	['queued', 'queued']
];

/** "2 reviewers working, 1 finished, 1 queued"; null before any reviewer is assigned. */
export function reviewerHeadline(assignments: ReviewAssignment[]): string | null {
	const statuses = latest(assignments).map(normalStatus);

	const parts = HEADLINE.map(([match, word]) => [statuses.filter((status) => status === match).length, word] as const)
		.filter(([count]) => count > 0)
		.map(([count, word], index) =>
			index === 0 ? `${count} reviewer${count === 1 ? '' : 's'} ${word}` : `${count} ${word}`
		);

	return parts.length > 0 ? parts.join(', ') : null;
}
