import { expect, test } from 'bun:test';
import { ORCHESTRATOR_ID, type ReviewChatMessage, type ReviewReasoningEntry } from '@recoder/shared';
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

	expect(rows.map((row) => row.key)).toEqual(['traces-thought-reason_plan', 'insert-agents', 'insert-progress']);
	expect(rows[0].kind === 'traces' && rows[0].traces[0]).toMatchObject({ until: '2026-01-01T00:00:30Z' });
});
