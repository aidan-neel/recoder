import { expect, test } from 'bun:test';
import {
	ORCHESTRATOR_ID,
	type ReviewChatMessage,
	type ReviewReasoningEntry,
	type ReviewToolCall
} from '@recoder/shared';
import { buildRows, orphansByIndex, placeInserts, reasoningByMessage } from '../../src/lib/review/conversation-rows';
import { groupTranscript } from '../../src/lib/review/review-transcript';

const thought = (id: string, second: number, text: string): ReviewReasoningEntry => ({
	id,
	at: `2026-01-01T00:00:${String(second).padStart(2, '0')}Z`,
	text,
	status: 'done'
});

const reply: ReviewChatMessage = {
	id: 'message_reason_retry',
	assignmentId: ORCHESTRATOR_ID,
	from: 'assistant',
	at: '2026-01-01T00:00:40Z',
	text: 'Reading the diff first.',
	status: 'done'
};

test('a failed turn and its retry read as one thought spanning both', () => {
	const reasoning = [thought('reason_failed', 0, 'First try.'), thought('reason_retry', 20, 'Second try.')];
	const entries = groupTranscript([reply], []);
	const orphans = reasoning.filter((entry) => `message_${entry.id}` !== reply.id);

	const rows = buildRows({
		entries,
		placed: [],
		orphansAt: orphansByIndex(orphans, entries),
		ownThoughts: reasoningByMessage(reasoning)
	});

	expect(rows.map((row) => row.kind)).toEqual(['traces', 'message']);

	const [merged] = rows[0].kind === 'traces' ? rows[0].traces : [];

	expect(merged).toMatchObject({
		kind: 'thought',
		key: 'thought-reason_failed',
		until: reply.at,
		entry: { at: '2026-01-01T00:00:00Z', text: 'First try.\n\nSecond try.' }
	});
});

test('back-to-back thoughts of two units reviewed side by side stay two thoughts', () => {
	const reasoning = [
		{ ...thought('reason_a', 0, 'Unit one.'), assignmentId: 'unit-1' },
		{ ...thought('reason_b', 5, 'Unit two.'), assignmentId: 'unit-2' }
	];

	const rows = buildRows({
		entries: [],
		placed: [],
		orphansAt: orphansByIndex(reasoning, []),
		ownThoughts: new Map()
	});

	expect(rows.flatMap((row) => (row.kind === 'traces' ? row.traces.map((trace) => trace.key) : []))).toEqual([
		'thought-reason_a',
		'thought-reason_b'
	]);
});

test('a thought before the agents were created sits above them, ending when they start', () => {
	const snippet = (() => {}) as never;
	const planning = thought('reason_plan', 5, 'Planning.');

	const rows = buildRows({
		entries: [],
		placed: placeInserts(
			[
				{ key: 'progress', snippet },
				{ key: 'agents', at: '2026-01-01T00:00:30Z', snippet }
			],
			[]
		),
		orphansAt: orphansByIndex([planning], []),
		ownThoughts: new Map()
	});

	expect(rows.map((row) => row.key)).toEqual(['traces-start', 'insert-agents', 'insert-progress']);
	expect(rows[0].kind === 'traces' && rows[0].traces[0]).toMatchObject({ until: '2026-01-01T00:00:30Z' });
});

test('an agent still working after a message gets a live row its next tools land in', () => {
	const entries = groupTranscript([reply], []);
	const input = { entries, placed: [], orphansAt: new Map(), ownThoughts: new Map() };
	const waiting = buildRows({ ...input, pending: true }).at(-1);

	const tool: ReviewToolCall = {
		id: 'tool-1',
		assignmentId: ORCHESTRATOR_ID,
		command: 'cat package.json',
		status: 'running',
		exitCode: null,
		startedAt: '2026-01-01T00:00:45Z'
	};

	const landed = buildRows({ ...input, entries: groupTranscript([reply], [tool]), pending: true }).at(-1);

	expect(waiting).toMatchObject({ kind: 'traces', traces: [], pending: true });
	expect(landed).toMatchObject({ kind: 'traces', key: waiting?.key, pending: true });
	expect(buildRows(input).map((row) => row.kind)).toEqual(['message']);
});

test('live progress at the end of the transcript takes no pending row', () => {
	const rows = buildRows({
		entries: [],
		placed: placeInserts([{ key: 'progress', snippet: (() => {}) as never }], []),
		orphansAt: new Map(),
		ownThoughts: new Map(),
		pending: true
	});

	expect(rows.map((row) => row.key)).toEqual(['insert-progress']);
});
