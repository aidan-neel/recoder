import {
	emptyReviewProgress,
	type Review,
	type ReviewAssignment,
	type ReviewChatMessage,
	type ReviewProgress,
	type ReviewReasoningEntry,
	type ReviewTask,
	type ReviewToolCall
} from '@recoder/shared';

export interface ProgressMessage {
	type: string;
	sequence?: number;
	at?: string;
	message?: string;
	step?: string;
	status?: string;
	review?: Review;
	snapshot?: ReviewProgress;
	data?: {
		task?: ReviewTask;
		assignment?: ReviewAssignment;
		assignments?: ReviewAssignment[];
		reasoning?: Omit<ReviewReasoningEntry, 'at'> & { at?: string };
		tool?: ReviewToolCall;
		chatMessage?: ReviewChatMessage;
		agent?: string;
		[key: string]: unknown;
	};
}

const SNAPSHOT_KEYS = [
	'paused',
	'approval',
	'planVersion',
	'planSummary',
	'assignments',
	'roleDecisions',
	'budget',
	'candidateCount',
	'coverage',
	'coverageGaps',
	'outcome',
	'failure',
	'recommendedChecks',
	'stage',
	'planningDegraded',
	'orchestratorModel',
	'guidelines'
] as const;

export function applyProgressMessage(current: ReviewProgress, event: ProgressMessage): ReviewProgress {
	if (event.snapshot) {
		return event.snapshot.id === current.id && event.snapshot.sequence >= current.sequence ? event.snapshot : current;
	}

	if (!event.sequence || event.sequence <= current.sequence) return current;

	const next: ReviewProgress = { ...current, sequence: event.sequence, updatedAt: event.at ?? current.updatedAt };
	const data = event.data;
	const settled = data?.settled as Pick<ReviewProgress, 'messages' | 'reasoning'> | undefined;

	if (settled) {
		next.messages = settled.messages;
		next.reasoning = settled.reasoning;
	}

	if (data) {
		for (const key of SNAPSHOT_KEYS) {
			if (key in data) (next as unknown as Record<string, unknown>)[key] = data[key];
		}
	}

	const task = event.data?.task;

	if (event.type === 'message' && event.data?.chatMessage) {
		const entry = event.data.chatMessage;
		const list = [...(current.messages ?? [])];
		const index = list.findIndex((item) => item.id === entry.id);

		if (index >= 0) list[index] = entry;
		else list.push(entry);
		next.messages = list.slice(-500);
	}

	if (event.type === 'task' && task) {
		const previous = current.tasks[task.id];

		next.tasks = { ...current.tasks, [task.id]: { ...previous, ...task, updatedAt: next.updatedAt } };
		if (previous?.message === task.message && previous?.status === task.status) return next;
	}

	if (event.type === 'assignment' && event.data?.assignment) {
		const assignment = event.data.assignment;
		const list = [...(next.assignments ?? current.assignments ?? [])];
		const index = list.findIndex((item) => item.id === assignment.id);

		if (index >= 0) list[index] = assignment;
		else list.push(assignment);
		next.assignments = list;
	}

	if (event.type === 'reasoning' && event.data?.reasoning) {
		const prior = current.reasoning?.find((item) => item.id === event.data?.reasoning?.id);

		const entry: ReviewReasoningEntry = {
			...event.data.reasoning,
			at: event.data.reasoning.at ?? prior?.at ?? next.updatedAt
		};

		const list = [...(current.reasoning ?? [])];
		const index = list.findIndex((item) => item.id === entry.id);

		if (index >= 0) list[index] = entry;
		else list.push(entry);
		next.reasoning = list.slice(-200);
	}

	if (event.type === 'tool' && event.data?.tool) {
		const tool = event.data.tool;
		const list = [...(current.toolCalls ?? [])];
		const index = list.findIndex((item) => item.id === tool.id);

		if (index >= 0) list[index] = tool;
		else list.push(tool);
		next.toolCalls = list.slice(-300);
	}

	const tool = event.data?.tool;

	const activityMessage =
		event.type === 'tool' && tool
			? `${tool.command} · ${tool.status === 'error' ? 'failed' : tool.exitCode === null ? 'complete' : `exit ${tool.exitCode}`}`
			: event.message;

	if (
		activityMessage &&
		event.type !== 'reasoning' &&
		event.type !== 'message' &&
		event.type !== 'finding' &&
		!(event.type === 'tool' && event.data?.tool?.status === 'running')
	) {
		next.activity = [
			...current.activity,
			{
				sequence: event.sequence,
				message: activityMessage,
				at: next.updatedAt,
				agent:
					task?.agent ??
					event.data?.assignment?.role ??
					event.data?.agent ??
					(event.step?.startsWith('agent:') ? event.step.slice(6) : undefined)
			}
		].slice(-100);
	}

	return next;
}

/** Pipeline stages in order; the index is what `review-steps.svelte` renders. */
const STAGE_LABELS = [
	'Checkout',
	'Understand changes',
	'Running checks',
	'Specialist review',
	'Verifying findings',
	'Consolidation'
] as const;

/**
 * Where a review stands, from its stored status and live progress: the stage
 * index (6 once passed), its label, and the running step's own message.
 */
export function reviewStage(
	progress: ReviewProgress,
	status: Review['status']
): { index: number; label: string; detail?: string } {
	const assignments = progress.assignments ?? [];

	const index =
		status === 'passed'
			? 6
			: progress.stage === 'consolidation' || progress.tasks.finalize
				? 5
				: progress.stage === 'verify'
					? 4
					: progress.stage === 'specialists'
						? 3
						: progress.stage === 'checks'
							? 2
							: assignments.length > 0
								? 3
								: progress.stage === 'understand' || progress.tasks.inventory || progress.tasks.planning
									? 1
									: 0;

	const label =
		status === 'passed'
			? 'Review complete'
			: status === 'failed'
				? 'Review failed'
				: progress.paused
					? 'Paused'
					: progress.approval?.status === 'pending'
						? 'Waiting for your go-ahead'
						: ((STAGE_LABELS as readonly string[])[index] ?? 'Review complete');

	const detail =
		index === 0
			? progress.tasks[['fetch', 'sandbox', 'diff'].find((id) => progress.tasks[id]?.status === 'running') ?? 'fetch']
					?.message
			: index === 2
				? (progress.tasks.checks?.status === 'running' ? progress.tasks.checks : progress.tasks.setup)?.message
				: undefined;

	return { index, label, detail };
}

export function taskSummary(tasks: ReviewTask[]) {
	const done = tasks.filter((task) => task.status === 'done' || task.status === 'skipped').length;
	const failed = tasks.filter((task) => task.status === 'error').length;
	const running = tasks.filter((task) => task.status === 'running' || task.status === 'waiting').length;

	return { done, failed, running, total: tasks.length, settled: done + failed };
}

export { emptyReviewProgress };
