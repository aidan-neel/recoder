import { emptyReviewProgress, type ReviewProgress, type ReviewTask } from '@recoder/shared';

export interface ProgressMessage {
	type: string;
	sequence?: number;
	at?: string;
	message?: string;
	step?: string;
	status?: string;
	snapshot?: ReviewProgress;
	data?: { task?: ReviewTask; agent?: string; [key: string]: unknown };
}

export function applyProgressMessage(current: ReviewProgress, event: ProgressMessage): ReviewProgress {
	if (event.type === 'snapshot' && event.snapshot) return event.snapshot;
	if (!event.sequence || event.sequence <= current.sequence) return current;
	const next = { ...current, sequence: event.sequence, updatedAt: event.at ?? current.updatedAt };
	const task = event.data?.task;
	if (event.type === 'task' && task) {
		const previous = current.tasks[task.id];
		next.tasks = { ...current.tasks, [task.id]: { ...previous, ...task, updatedAt: next.updatedAt } };
		if (previous?.message === task.message && previous?.status === task.status) return next;
	}
	if (event.message && event.type !== 'finding') {
		next.activity = [...current.activity, {
			sequence: event.sequence, message: event.message, at: next.updatedAt,
			agent: task?.agent ?? event.data?.agent ?? (event.step?.startsWith('agent:') ? event.step.slice(6) : undefined)
		}].slice(-100);
	}
	return next;
}

export function taskSummary(tasks: ReviewTask[]) {
	const done = tasks.filter((task) => task.status === 'done' || task.status === 'skipped').length;
	const failed = tasks.filter((task) => task.status === 'error').length;
	const running = tasks.filter((task) => task.status === 'running').length;
	return { done, failed, running, total: tasks.length, settled: done + failed };
}

export { emptyReviewProgress };
