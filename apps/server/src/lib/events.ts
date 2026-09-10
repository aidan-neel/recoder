import {
	emptyReviewProgress,
	type CoverageGap,
	type CoverageSummary,
	type ReviewAssignment,
	type ReviewBudgetSnapshot,
	type ReviewProgress,
	type ReviewStage,
	type ReviewTask,
	type RoleDecision
} from '@recoder/shared';
import { reviewProgress } from '../store';

/**
 * In-memory per-review event bus backing the SSE endpoint.
 * A short ring buffer is replayed to new subscribers so a late-opening
 * in-progress page (or EventSource reconnect) still sees agent output.
 */

export type ReviewEventType = 'step' | 'log' | 'done' | 'error' | 'finding' | 'task' | 'plan' | 'coverage' | 'assignment';

export interface ReviewEvent {
	type: ReviewEventType;
	/** Machine step name, e.g. `fetch`, `sandbox`, `agent:security`. */
	step?: string;
	message: string;
	/** Structured payload, e.g. `{ agent: 'security', status: 'done', findings: 2 }`. */
	data?: Record<string, unknown>;
	at: string;
	sequence?: number;
}

type Listener = (event: ReviewEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const buffers = new Map<string, ReviewEvent[]>();

const MAX_BUFFER = 400;

const SNAPSHOT_KEYS = [
	'planVersion',
	'planSummary',
	'assignments',
	'roleDecisions',
	'budget',
	'candidateCount',
	'coverage',
	'coverageGaps',
	'outcome',
	'recommendedChecks',
	'stage',
	'planningDegraded'
] as const;

export function emitReviewEvent(reviewId: string, event: Omit<ReviewEvent, 'at'>): void {
	const snapshot = reviewProgress.get(reviewId) ?? emptyReviewProgress(reviewId);
	const message: ReviewEvent = { ...event, at: new Date().toISOString(), sequence: snapshot.sequence + 1 };
	snapshot.sequence = message.sequence!;
	snapshot.updatedAt = message.at;
	if (event.type === 'task' && event.data?.task) {
		const task = event.data.task as ReviewTask;
		const previous = snapshot.tasks[task.id];
		const startedAt = previous?.startedAt ?? task.startedAt ??
			(task.status === 'running' || task.status === 'waiting' ? message.at : undefined);
		snapshot.tasks[task.id] = {
			...previous, ...task, startedAt, updatedAt: message.at,
			elapsedMs: task.elapsedMs ?? (startedAt ? Date.parse(message.at) - Date.parse(startedAt) : previous?.elapsedMs)
		};
		message.data = { ...message.data, task: snapshot.tasks[task.id] };
		if (previous?.message !== task.message || previous?.status !== task.status) {
			snapshot.activity.push({ sequence: snapshot.sequence, message: task.message, at: message.at, agent: task.agent });
		}
	} else if (event.type === 'finding') {
		// Candidate/finding payloads stay off the activity transcript.
	} else {
		snapshot.activity.push({ sequence: snapshot.sequence, message: message.message, at: message.at, agent: event.data?.agent as string | undefined ?? (event.step?.startsWith('agent:') ? event.step.slice(6) : undefined) });
	}
	applySnapshotPatch(snapshot, event.data);
	snapshot.activity = snapshot.activity.slice(-100);
	reviewProgress.set(snapshot);
	let buf = buffers.get(reviewId);
	if (!buf) {
		buf = [];
		buffers.set(reviewId, buf);
	}
	buf.push(message);
	if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
	listeners.get(reviewId)?.forEach((fn) => {
		try {
			fn(message);
		} catch {
			// Listener failures must never break the pipeline.
		}
	});
}

function applySnapshotPatch(snapshot: ReviewProgress, data?: Record<string, unknown>): void {
	if (!data) return;
	for (const key of SNAPSHOT_KEYS) {
		if (key in data) (snapshot as unknown as Record<string, unknown>)[key] = data[key];
	}
}

export function subscribeReview(reviewId: string, fn: Listener, replay = true): () => void {
	for (const event of replay ? buffers.get(reviewId) ?? [] : []) {
		try {
			fn(event);
		} catch {
			// Replay failures must never break subscribe.
		}
	}
	let set = listeners.get(reviewId);
	if (!set) {
		set = new Set();
		listeners.set(reviewId, set);
	}
	set.add(fn);
	return () => {
		set.delete(fn);
		if (set.size === 0) listeners.delete(reviewId);
	};
}

export function listenerCount(reviewId: string): number {
	return listeners.get(reviewId)?.size ?? 0;
}

export function reviewEventBuffer(reviewId: string): ReviewEvent[] {
	return buffers.get(reviewId) ?? [];
}

export function clearReviewEvents(reviewId: string): void {
	reviewProgress.delete(reviewId);
	buffers.delete(reviewId);
	listeners.delete(reviewId);
}

export function reportReviewTask(reviewId: string, task: Omit<ReviewTask, 'updatedAt'>): void {
	emitReviewEvent(reviewId, { type: 'task', message: task.message, data: { task } });
}

export function reportReviewPlan(
	reviewId: string,
	data: {
		planVersion: number;
		summary: string;
		assignments: ReviewAssignment[];
		roleDecisions: RoleDecision[];
		planningDegraded?: boolean;
	}
): void {
	emitReviewEvent(reviewId, {
		type: 'plan',
		message: data.summary,
		data: {
			planVersion: data.planVersion,
			planSummary: data.summary,
			assignments: data.assignments,
			roleDecisions: data.roleDecisions,
			planningDegraded: data.planningDegraded
		}
	});
}

export function reportReviewAssignment(reviewId: string, assignment: ReviewAssignment): void {
	const snapshot = reviewProgress.get(reviewId);
	const assignments = [...(snapshot?.assignments ?? [])];
	const index = assignments.findIndex((item) => item.id === assignment.id);
	if (index >= 0) assignments[index] = assignment;
	else assignments.push(assignment);
	emitReviewEvent(reviewId, {
		type: 'assignment',
		step: `assignment:${assignment.id}`,
		message: assignment.currentOperation ?? assignment.title,
		data: { assignment, assignments, agent: assignment.role }
	});
}

export function reportReviewCoverage(reviewId: string, coverage: CoverageSummary, coverageGaps: CoverageGap[]): void {
	emitReviewEvent(reviewId, {
		type: 'coverage',
		message: `Coverage ${coverage.reviewed}/${coverage.total} reviewed`,
		data: { coverage, coverageGaps }
	});
}

export function reportReviewBudget(reviewId: string, budget: ReviewBudgetSnapshot): void {
	emitReviewEvent(reviewId, {
		type: 'log',
		message: `Model budget ${budget.used}/${budget.limit} used`,
		data: { budget }
	});
}

/** Report liveness during opaque operations without inventing a percentage. */
export async function trackReviewTask<T>(
	reviewId: string,
	id: string,
	label: string,
	work: (detail: (message: string) => void) => Promise<T>
): Promise<T> {
	const started = Date.now();
	let latestMessage = label;
	const update = (status: ReviewTask['status'], message = latestMessage) => reportReviewTask(reviewId, {
		id, label, status, message, startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, kind: 'checkout'
	});
	update('running');
	const timer = setInterval(() => update('running'), 5000);
	try {
		const result = await work((message) => { latestMessage = message; update('running'); });
		update('done');
		return result;
	} catch (err) {
		update('error', err instanceof Error ? err.message : 'Operation failed');
		throw err;
	} finally {
		clearInterval(timer);
	}
}
