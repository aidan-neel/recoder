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

/** Keeps inserted blocks (specialists, results) at their point in time as follow-ups arrive. */
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

/**
 * Transcript in order. Back-to-back tool groups fold into one row; every thought is its own row
 * with its own timer, never nested in another. A thought is keyed under its reply id and its own
 * id, so two messages can both claim it; each is placed once (duplicate keys crash the keyed list).
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

		if (
			item.kind === 'tasks' &&
			previous?.kind === 'traces' &&
			previous.traces.every((trace) => trace.kind === 'tasks')
		)
			previous.traces.push(item);
		else out.push({ kind: 'traces', key: `traces-${item.key}`, traces: [item] });
	};

	/** Something later in the transcript means a thought is over, even if its entry was never closed. */
	const before = (index: number) => {
		for (const insert of placed)
			if (insert.index === index) out.push({ kind: 'insert', key: `insert-${insert.key}`, snippet: insert.snippet });

		const next = entries[index]?.at;

		for (const entry of orphansAt.get(index) ?? [])
			trace({ kind: 'thought', key: `thought-${entry.id}`, entry, until: next });
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
