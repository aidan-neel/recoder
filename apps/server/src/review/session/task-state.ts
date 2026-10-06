import type { ReviewTask, ReviewTaskStatus } from '@recoder/shared';

/**
 * A task has finished once it reaches one of these: `done`, or `partial` when
 * it ran but part of its work did not finish; `error` when it failed (a
 * cancelled review's tasks fail with `REVIEW_CANCELLED` as their message); and
 * `skipped`, whose message says why it never ran.
 */
const TERMINAL: ReadonlySet<ReviewTaskStatus> = new Set(['done', 'partial', 'error', 'skipped']);

/** Why work still going when a complete review finished is `partial`. */
export const STILL_RUNNING = 'Still running when the review finished';

const NOT_STARTED = 'Not started before the review finished';

export function isTerminalTask(task: Pick<ReviewTask, 'status'>): boolean {
	return TERMINAL.has(task.status);
}

/** Tasks a finished review should not have: any still active, and any skipped without saying why. */
export function unsettledTasks(tasks: ReviewTask[]): ReviewTask[] {
	return tasks.filter((task) => !isTerminalTask(task) || (task.status === 'skipped' && !task.message.trim()));
}

/**
 * Every task still active when a review stops, closed out. When the review
 * completed, running work is `partial` and queued work `skipped`, since it
 * never started; when it failed or was cancelled, both fail with `failure`.
 * Returns only the tasks it changed.
 */
export function settleTasks(tasks: ReviewTask[], failure: string | null): ReviewTask[] {
	return tasks
		.filter((task) => !isTerminalTask(task))
		.map((task): ReviewTask => {
			if (failure) return { ...task, status: 'error', message: failure };

			return task.status === 'queued'
				? { ...task, status: 'skipped', message: NOT_STARTED }
				: { ...task, status: 'partial', message: STILL_RUNNING };
		});
}
