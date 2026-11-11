import {
	emptyReviewProgress,
	type CoverageGap,
	type CoverageSummary,
	type ReviewAssignment,
	type ReviewChatMessage,
	type ReviewProgress,
	type ReviewReasoningEntry,
	type ReviewTask,
	type ReviewToolCall
} from '@recoder/shared';
import { db, reviewProgress } from '../../store';
import { progressWrites } from '../../storage/persistence-queue';
import { settleTasks } from './task-state';

type ReviewEventType =
	| 'step'
	| 'log'
	| 'done'
	| 'error'
	| 'finding'
	| 'task'
	| 'plan'
	| 'coverage'
	| 'assignment'
	| 'reasoning'
	| 'message'
	| 'tool';

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

/** Short ring buffers replayed to new subscribers, so a late-opening page (or an EventSource reconnect) still sees agent output. */
const buffers = new Map<string, ReviewEvent[]>();

const MAX_BUFFER = 400;

function writeQueue(reviewId: string) {
	return progressWrites.for(reviewId);
}

export async function flushReviewEvents(reviewId: string): Promise<void> {
	await progressWrites.drain(reviewId);
}

const SNAPSHOT_KEYS = [
	'paused',
	'planVersion',
	'assignments',
	'budget',
	'candidateCount',
	'coverage',
	'coverageGaps',
	'outcome',
	'failure',
	'recommendedChecks',
	'stage',
	'orchestratorModel',
	'guidelines'
] as const;

/** Hand an event to one listener. A listener's failure must never break the pipeline or a replay. */
function deliver(fn: Listener, event: ReviewEvent): void {
	try {
		fn(event);
	} catch {
		return;
	}
}

function applyTask(snapshot: ReviewProgress, message: ReviewEvent, task: ReviewTask): void {
	const previous = snapshot.tasks[task.id];

	const startedAt =
		previous?.startedAt ??
		task.startedAt ??
		(task.status === 'running' || task.status === 'waiting' ? message.at : undefined);

	snapshot.tasks[task.id] = {
		...previous,
		...task,
		startedAt,
		updatedAt: message.at,
		elapsedMs: task.elapsedMs ?? (startedAt ? Date.parse(message.at) - Date.parse(startedAt) : previous?.elapsedMs)
	};

	message.data = { ...message.data, task: snapshot.tasks[task.id] };

	if (previous?.message !== task.message || previous?.status !== task.status) {
		snapshot.activity.push({ sequence: snapshot.sequence, message: task.message, at: message.at, agent: task.agent });
	}
}

function applyChatMessage(snapshot: ReviewProgress, message: ReviewEvent, entry: ReviewChatMessage): void {
	const entries = [...(snapshot.messages ?? [])];
	const index = entries.findIndex((item) => item.id === entry.id);
	const next = { ...entry, text: entry.text.slice(0, 64_000), at: entries[index]?.at ?? entry.at ?? message.at };

	if (index >= 0) entries[index] = next;
	else entries.push(next);
	snapshot.messages = entries.slice(-500);
	message.data = { ...message.data, chatMessage: next };
}

/** Reasoning streams as growing deltas sharing one id; upsert so the entry holds the accumulated text, not every token. */
function applyReasoning(snapshot: ReviewProgress, message: ReviewEvent, entry: Omit<ReviewReasoningEntry, 'at'>): void {
	const reasoning = [...(snapshot.reasoning ?? [])];
	const index = reasoning.findIndex((item) => item.id === entry.id);

	const ended = entry.status === 'done' || entry.status === 'error';

	const next: ReviewReasoningEntry = {
		...entry,
		text: entry.text.slice(0, 64_000),
		at: reasoning[index]?.at ?? message.at,
		...(ended ? { endedAt: reasoning[index]?.endedAt ?? message.at } : {})
	};

	message.data = { ...message.data, reasoning: next };
	if (index >= 0) reasoning[index] = next;
	else reasoning.push(next);
	snapshot.reasoning = reasoning.slice(-200);
}

function applyTool(snapshot: ReviewProgress, message: ReviewEvent, tool: ReviewToolCall): void {
	const toolCalls = [...(snapshot.toolCalls ?? [])];
	const index = toolCalls.findIndex((item) => item.id === tool.id);

	if (index >= 0) toolCalls[index] = tool;
	else toolCalls.push(tool);
	snapshot.toolCalls = toolCalls.slice(-300);

	if (tool.status !== 'running') {
		snapshot.activity.push({
			sequence: snapshot.sequence,
			message:
				tool.status === 'error'
					? `${tool.command} · failed`
					: `${tool.command} · ${tool.exitCode === null ? 'complete' : `exit ${tool.exitCode}`}`,
			at: message.at,
			agent: tool.role
		});
	}
}

/** Fold one event into the review's snapshot. Finding events carry candidate payloads that stay off the activity transcript. */
function applyEvent(snapshot: ReviewProgress, event: Omit<ReviewEvent, 'at'>, message: ReviewEvent): void {
	if (event.type === 'assignment' && event.data?.assignment) {
		const assignment = event.data.assignment as ReviewAssignment;
		const assignments = [...(snapshot.assignments ?? [])];
		const index = assignments.findIndex((item) => item.id === assignment.id);

		if (index >= 0) assignments[index] = assignment;
		else assignments.push(assignment);
		snapshot.assignments = assignments;
		message.data = { ...message.data, assignments };
	}

	if (event.type === 'task' && event.data?.task) applyTask(snapshot, message, event.data.task as ReviewTask);
	else if (event.type === 'message' && event.data?.chatMessage)
		applyChatMessage(snapshot, message, event.data.chatMessage as ReviewChatMessage);
	else if (event.type === 'reasoning' && event.data?.reasoning)
		applyReasoning(snapshot, message, event.data.reasoning as Omit<ReviewReasoningEntry, 'at'>);
	else if (event.type === 'tool' && event.data?.tool) applyTool(snapshot, message, event.data.tool as ReviewToolCall);
	else if (event.type !== 'finding' && message.message) {
		snapshot.activity.push({
			sequence: snapshot.sequence,
			message: message.message,
			at: message.at,
			agent:
				(event.data?.agent as string | undefined) ??
				(event.step?.startsWith('agent:') ? event.step.slice(6) : undefined)
		});
	}
}

/** Record an event on the in-memory per-review bus behind the SSE endpoint, and in the review's progress snapshot. */
export function enqueueReviewWrite(reviewId: string, write: () => Promise<unknown>): void {
	writeQueue(reviewId).push(write);
}

export function emitReviewChatMessage(reviewId: string, message: ReviewChatMessage): void {
	const saved = structuredClone(message);

	enqueueReviewWrite(reviewId, async () => {
		if (await db.reviews.get(reviewId))
			await commitReviewEvent(reviewId, { type: 'message', step: 'chat', message: '', data: { chatMessage: saved } });
	});
}

export function emitReviewEvent(reviewId: string, event: Omit<ReviewEvent, 'at'>): void {
	const saved = structuredClone(event);

	enqueueReviewWrite(reviewId, () => commitReviewEvent(reviewId, saved));
}

async function commitReviewEvent(reviewId: string, event: Omit<ReviewEvent, 'at'>): Promise<void> {
	let message: ReviewEvent = { ...event, at: new Date().toISOString() };

	await reviewProgress.update(reviewId, (current) => {
		const snapshot = current ?? emptyReviewProgress(reviewId);

		message = { ...message, sequence: snapshot.sequence + 1 };

		snapshot.sequence = message.sequence!;
		snapshot.updatedAt = message.at;
		applyEvent(snapshot, event, message);
		applySnapshotPatch(snapshot, event.data);
		snapshot.activity = snapshot.activity.slice(-100);

		return snapshot;
	});

	let buf = buffers.get(reviewId);

	if (!buf) {
		buf = [];
		buffers.set(reviewId, buf);
	}

	buf.push(message);
	if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);

	listeners.get(reviewId)?.forEach((fn) => deliver(fn, message));
}

/** Copy snapshot fields an event carries. A finished pipeline settles its half-streamed replies and reasoning in one go. */
function applySnapshotPatch(snapshot: ReviewProgress, data?: Record<string, unknown>): void {
	if (!data) return;

	const settled = data.settled as Pick<ReviewProgress, 'messages' | 'reasoning'> | undefined;

	if (settled) {
		snapshot.messages = settled.messages;
		snapshot.reasoning = settled.reasoning;
	}

	for (const key of SNAPSHOT_KEYS) {
		if (key in data) (snapshot as unknown as Record<string, unknown>)[key] = data[key];
	}
}

export function subscribeReview(reviewId: string, fn: Listener, replay = true): () => void {
	for (const event of replay ? (buffers.get(reviewId) ?? []) : []) deliver(fn, event);

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

export async function reviewEventBuffer(reviewId: string): Promise<ReviewEvent[]> {
	await flushReviewEvents(reviewId);

	return buffers.get(reviewId) ?? [];
}

export async function clearReviewEvents(reviewId: string): Promise<void> {
	await flushReviewEvents(reviewId);
	await reviewProgress.delete(reviewId);
	progressWrites.delete(reviewId);
	buffers.delete(reviewId);
	listeners.delete(reviewId);
}

export function reportReviewTask(reviewId: string, task: Omit<ReviewTask, 'updatedAt'>): void {
	emitReviewEvent(reviewId, { type: 'task', message: task.message, data: { task } });
}

/**
 * Closes every task the review left active as its run ends (see
 * `settleTasks`): `failure` for a failed or cancelled run, null for a
 * complete one. Each goes out as a task event, so open pages see it too.
 */
export async function settleReviewTasks(reviewId: string, failure: string | null): Promise<void> {
	await flushReviewEvents(reviewId);

	const snapshot = await reviewProgress.get(reviewId);

	for (const task of settleTasks(Object.values(snapshot?.tasks ?? {}), failure)) reportReviewTask(reviewId, task);
}

export function reportReviewPlan(
	reviewId: string,
	data: {
		planVersion: number;
		summary: string;
		assignments: ReviewAssignment[];
	}
): void {
	emitReviewEvent(reviewId, {
		type: 'plan',
		message: data.summary,
		data: {
			planVersion: data.planVersion,
			assignments: data.assignments
		}
	});
}

export function reportReviewAssignment(reviewId: string, assignment: ReviewAssignment): void {
	emitReviewEvent(reviewId, {
		type: 'assignment',
		step: `assignment:${assignment.id}`,
		message: assignment.currentOperation ?? assignment.title,
		data: { assignment, agent: assignment.role }
	});
}

/** Report accumulated provider reasoning for an assignment turn (upsert by id). */
export function reportReviewReasoning(reviewId: string, reasoning: Omit<ReviewReasoningEntry, 'at'>): void {
	emitReviewEvent(reviewId, {
		type: 'reasoning',
		step: reasoning.assignmentId ? `assignment:${reasoning.assignmentId}` : 'review',
		message: '',
		data: { reasoning, agent: reasoning.role }
	});
}

/** Report one tool/retrieval call; the same id updates it from running to finished. */
export function reportReviewTool(reviewId: string, tool: ReviewToolCall): void {
	emitReviewEvent(reviewId, {
		type: 'tool',
		step: tool.assignmentId ? `assignment:${tool.assignmentId}` : 'review',
		message: tool.command,
		data: { tool, agent: tool.role }
	});
}

export function reportReviewCoverage(reviewId: string, coverage: CoverageSummary, coverageGaps: CoverageGap[]): void {
	emitReviewEvent(reviewId, {
		type: 'coverage',
		message: `Coverage ${coverage.reviewed}/${coverage.total} reviewed`,
		data: { coverage, coverageGaps }
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

	const update = (status: ReviewTask['status'], message = latestMessage) =>
		reportReviewTask(reviewId, {
			id,
			label,
			status,
			message,
			startedAt: new Date(started).toISOString(),
			elapsedMs: Date.now() - started,
			kind: 'checkout'
		});

	update('running');

	const timer = setInterval(() => update('running'), 5000);

	try {
		const result = await work((message) => {
			latestMessage = message;
			update('running');
		});

		update('done');

		return result;
	} catch (err) {
		update('error', err instanceof Error ? err.message : 'Operation failed');
		throw err;
	} finally {
		clearInterval(timer);
	}
}
