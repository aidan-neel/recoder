import type { ReviewAssignment, ReviewProgress, ReviewStage, ReviewTask, ReviewTaskKind } from '@recoder/shared';

import { isSubagent } from './reviewers';
import type { StageRow } from './stages';

/** When a stage's own work started and, once all of it settled, when it ended; epoch ms. */
interface Span {
	start: number;
	end: number | null;
}

/** The task kinds whose work belongs to a stage. Review and Subagents are timed by their reviewers instead. */
const STAGE_KINDS: Partial<Record<ReviewStage, ReviewTaskKind[]>> = {
	checkout: ['checkout'],
	understand: ['inventory', 'planning'],
	checks: ['setup', 'checks'],
	verify: ['verification'],
	consolidation: ['consolidation']
};

const SETTLED_TASK = new Set<ReviewTask['status']>(['done', 'error', 'skipped', 'partial']);

const SETTLED_REVIEWER = new Set<ReviewAssignment['status']>(['done', 'error', 'skipped']);

/** A timestamp as epoch ms; null when missing or unreadable. */
function time(at: string | undefined): number | null {
	const ms = at ? Date.parse(at) : NaN;

	return Number.isFinite(ms) ? ms : null;
}

/** The earliest start and, when every item settled, the latest end of a stage's work; null when none of it started. */
function spanOf(items: { start: number | null; end: number | null; settled: boolean }[]): Span | null {
	const started = items.filter((item): item is typeof item & { start: number } => item.start !== null);

	if (started.length === 0) return null;

	const ends = started.map((item) => (item.settled ? item.end : null));
	const open = ends.some((end) => end === null);

	return { start: Math.min(...started.map((item) => item.start)), end: open ? null : Math.max(...(ends as number[])) };
}

function taskSpan(progress: ReviewProgress, kinds: ReviewTaskKind[]): Span | null {
	const tasks = Object.values(progress.tasks).filter((task) => task.kind && kinds.includes(task.kind));

	return spanOf(
		tasks.map((task) => ({
			start: time(task.startedAt),
			end: time(task.updatedAt),
			settled: SETTLED_TASK.has(task.status)
		}))
	);
}

function reviewerSpan(progress: ReviewProgress, subagents: boolean): Span | null {
	const assignments = (progress.assignments ?? []).filter((item) => isSubagent(item) === subagents);

	return spanOf(
		assignments.map((assignment) => ({
			start: time(assignment.startedAt),
			end: time(assignment.completedAt),
			settled: SETTLED_REVIEWER.has(assignment.status)
		}))
	);
}

function stageSpan(progress: ReviewProgress, key: ReviewStage): Span | null {
	if (key === 'reviewing' || key === 'subagents') return reviewerSpan(progress, key === 'subagents');

	const kinds = STAGE_KINDS[key];

	return kinds ? taskSpan(progress, kinds) : null;
}

/** How a stage stands in time: how long a finished one took, or when the running one started. */
export interface StageTime {
	/** A finished stage's length in ms. */
	took: number | null;
	/** The running stage's start, epoch ms, for a clock that counts up. */
	since: number | null;
}

/**
 * Each listed stage's time, read from the timestamps of its own tasks and
 * reviewers. A finished stage took from its first start to whichever comes
 * first: its last piece of work settling, or the next stage starting (stages
 * overlap, and late work such as a fix check would otherwise stretch an
 * early one). A stage with no timestamps, or with times that do not add up
 * (a resumed review mixes runs), shows none.
 */
export function stageTimes(progress: ReviewProgress, rows: StageRow[]): Map<ReviewStage, StageTime> {
	const spans = rows.map((row) => stageSpan(progress, row.key));

	return new Map(
		rows.map((row, index) => {
			const span = spans[index];
			const next = spans.slice(index + 1).find((later) => later !== null)?.start ?? null;
			const ends = [span?.end ?? null, next].filter((end): end is number => end !== null);
			const took = span && row.state === 'done' && ends.length > 0 ? Math.min(...ends) - span.start : null;

			return [
				row.key,
				{
					took: took !== null && took >= 0 ? took : null,
					since: span && row.state === 'active' ? span.start : null
				}
			];
		})
	);
}

/** "<1s", "41s", "2m 48s", "1h 4m": a length of time, to the second under an hour. */
export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);

	if (seconds < 1) return '<1s';
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);

	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
