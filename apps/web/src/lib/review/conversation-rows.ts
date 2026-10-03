import type { Snippet } from 'svelte';
import type { ReviewChatMessage, ReviewReasoningEntry, ReviewToolCall } from '@recoder/shared';
import type { TranscriptItem } from './review-transcript';

/** A block placed in the transcript before the first entry newer than `at` (or at the end). */
export interface TranscriptInsert {
	key: string;
	at?: string;
	snippet: Snippet;
}

/** A thought with its own timer, or a run of tool calls. */
export type Trace =
	| { kind: 'thought'; key: string; entry: ReviewReasoningEntry; until?: string }
	| { kind: 'tasks'; key: string; tools: ReviewToolCall[] };

export type Row =
	| { kind: 'insert'; key: string; snippet: Snippet }
	| { kind: 'message'; key: string; message: ReviewChatMessage; index: number }
	| { kind: 'traces'; key: string; traces: Trace[] };

/** The row a folded run shows: its most recent trace's label and glyph. */
export interface TraceHead {
	label: string;
	status?: 'running' | 'error' | 'done';
	thought?: { working: boolean; time?: string };
}

/** Index of the first entry newer than `at`, or the end of the transcript. */
function indexAfter(entries: TranscriptItem[], at: string): number {
	const found = entries.findIndex((entry) => Date.parse(entry.at) > Date.parse(at));

	return found < 0 ? entries.length : found;
}

/** Keeps inserted blocks (reviewers, results) at their point in time as follow-ups arrive. */
export function placeInserts(
	inserts: TranscriptInsert[],
	entries: TranscriptItem[]
): (TranscriptInsert & { index: number })[] {
	return inserts.map((insert) => ({
		...insert,
		index: insert.at ? indexAfter(entries, insert.at) : entries.length
	}));
}

/** Agent turns reply as `message_<reasoning id>`; discussion replies think as `reason_<reply id>`. Either way thinking sits with its reply. */
export function reasoningByMessage(reasoning: ReviewReasoningEntry[]): Map<string, ReviewReasoningEntry> {
	return new Map<string, ReviewReasoningEntry>(
		reasoning.flatMap((entry) => [
			[`message_${entry.id}`, entry],
			[entry.id.replace(/^reason_/, ''), entry]
		])
	);
}

/** Thinking with no reply of its own sits where it happened in time, not lumped at the top. */
export function orphansByIndex(
	orphans: ReviewReasoningEntry[],
	entries: TranscriptItem[]
): Map<number, ReviewReasoningEntry[]> {
	const byIndex = new Map<number, ReviewReasoningEntry[]>();

	for (const entry of orphans) {
		if (!entry.text.trim() && entry.status !== 'streaming') continue;

		const index = indexAfter(entries, entry.at);

		byIndex.set(index, [...(byIndex.get(index) ?? []), entry]);
	}

	return byIndex;
}

/** Sort key for a point in time; untimed items sort after everything. */
function timeOf(at?: string): number {
	const time = Date.parse(at ?? '');

	return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

/**
 * Two thoughts with nothing between them (a turn that failed and was asked again) read as one:
 * timed from the first start to the last end, with both texts, under the first one's key. Thoughts
 * of two units reviewed side by side stay apart.
 */
function mergeThoughts(first: Extract<Trace, { kind: 'thought' }>, next: Extract<Trace, { kind: 'thought' }>): Trace {
	const text = [first.entry.text, next.entry.text].filter((part) => part.trim()).join('\n\n');

	return {
		kind: 'thought',
		key: first.key,
		entry: { ...next.entry, at: first.entry.at, text, summary: first.entry.summary || next.entry.summary },
		until: next.until
	};
}

/**
 * Transcript in order. Back-to-back tool groups fold into one row, and back-to-back thoughts of one agent merge
 * into one; a thought is never nested in a tool group. A thought is keyed under its reply id and its
 * own id, so two messages can both claim it; each is placed once (duplicate keys crash the keyed list).
 */
export function buildRows(input: {
	entries: TranscriptItem[];
	placed: (TranscriptInsert & { index: number })[];
	orphansAt: Map<number, ReviewReasoningEntry[]>;
	ownThoughts: Map<string, ReviewReasoningEntry>;
}): Row[] {
	const { entries, placed, orphansAt, ownThoughts } = input;
	const out: Row[] = [];
	const placedTraces = new Set<string>();

	const trace = (item: Trace) => {
		if (placedTraces.has(item.key)) return;
		placedTraces.add(item.key);

		const previous = out.at(-1);
		const last = previous?.kind === 'traces' ? previous.traces.at(-1) : undefined;

		if (
			item.kind === 'thought' &&
			last?.kind === 'thought' &&
			previous?.kind === 'traces' &&
			last.entry.assignmentId === item.entry.assignmentId
		) {
			previous.traces[previous.traces.length - 1] = mergeThoughts(last, item);

			return;
		}

		if (
			item.kind === 'tasks' &&
			previous?.kind === 'traces' &&
			previous.traces.every((trace) => trace.kind === 'tasks')
		)
			previous.traces.push(item);
		else out.push({ kind: 'traces', key: `traces-${item.key}`, traces: [item] });
	};

	/**
	 * Inserts and stray thoughts at one spot, in the order they happened; untimed inserts (live progress)
	 * come last. Something later in the transcript means a thought is over, even if its entry was never closed.
	 */
	const before = (index: number) => {
		const items = [
			...placed.filter((insert) => insert.index === index).map((insert) => ({ at: insert.at, insert })),
			...(orphansAt.get(index) ?? []).map((entry) => ({ at: entry.at, entry }))
		].sort((a, b) => timeOf(a.at) - timeOf(b.at));

		items.forEach((item, position) => {
			if ('insert' in item) {
				out.push({ kind: 'insert', key: `insert-${item.insert.key}`, snippet: item.insert.snippet });

				return;
			}

			const until = items.slice(position + 1).find((next) => next.at)?.at ?? entries[index]?.at;

			trace({ kind: 'thought', key: `thought-${item.entry.id}`, entry: item.entry, until });
		});
	};

	entries.forEach((item, index) => {
		before(index);

		if (item.kind === 'tasks') {
			trace({ kind: 'tasks', key: `tasks-${item.id}`, tools: item.tools });

			return;
		}

		const ownThought = ownThoughts.get(item.message.id);

		if (ownThought)
			trace({ kind: 'thought', key: `thought-${ownThought.id}`, entry: ownThought, until: item.message.at });
		out.push({ kind: 'message', key: `message-${item.id}`, message: item.message, index });
	});

	before(entries.length);

	return out;
}

/** Whole seconds from `since` to `until` (or `now`), at least 1s; minutes past 60s. */
export function elapsed(now: number, since?: string, until?: string): string | undefined {
	const start = Date.parse(since ?? '');
	const end = until === undefined ? now : Date.parse(until);

	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;

	const seconds = Math.max(1, Math.floor((end - start) / 1000));

	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
