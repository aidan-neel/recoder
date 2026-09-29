import { afterEach, expect, test } from 'bun:test';
import { REVIEW_ROLES, type ReviewRole } from './roles';
import { resetLlmLimiter } from './llm';
import { getStoredSettings, setReviewOverrides } from './review-settings';
import { runAdaptiveReview, uniqueIds, type ReviewProgressCheckpoint } from './harness';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
	resetLlmLimiter();
});

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;
const HUNK = 'src/a.ts:1,1:1,1';

const assignment = (id: string, role: ReviewRole, priority: number) => ({
	id,
	role,
	title: id,
	reason: 'must',
	scope: [{ path: 'src/a.ts', hunkIds: [HUNK] }],
	questions: ['q'],
	contextEvidenceIds: [],
	priority
});

const PLAN = {
	summary: 'two specialists',
	assignments: [assignment('correctness-core', 'correctness', 1), assignment('patterns-core', 'patterns', 2)],
	roleDecisions: REVIEW_ROLES.map((role) => ({ role, decision: role === 'correctness' || role === 'patterns' ? 'selected' : 'not_needed', reason: 'r' }))
};
const NOTHING = { findings: [], examinedHunks: [HUNK], coverageGaps: [], blockers: [], followUp: null, recommendedChecks: [] };

/** Answers each prompt by its kind; `patterns` decides whether that specialist fails. */
function stubModel(calls: string[], patterns: 'fail' | 'ok') {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = String(JSON.parse(String(init?.body)).messages[0]?.content ?? '');
		const kind = system.includes('review orchestrator') ? 'planner'
			: system.includes('(correctness)') ? 'correctness'
			: system.includes('(patterns)') ? 'patterns'
			: 'consolidation';
		calls.push(kind);
		if (kind === 'patterns' && patterns === 'fail') return new Response('bad request', { status: 400 });
		const reply = kind === 'planner' ? PLAN
			: kind === 'correctness' ? { ...NOTHING, findings: [{ file: 'src/a.ts', line: 1, severity: 'medium', category: 'bug', body: 'possible miss', evidenceIds: [] }] }
			: kind === 'patterns' ? NOTHING
			: { keep: ['c1'], merge: [], reject: [], recommendedChecks: [] };
		return Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'ok', ...reply }) } }] });
	}) as unknown as typeof fetch;
}

test('a resumed review reruns only unfinished specialists and keeps the finished ones’ findings', async () => {
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'test', label: 'Test', model: 'test' }] });
	const first: string[] = [];
	stubModel(first, 'fail');
	let saved: ReviewProgressCheckpoint | null = null;
	const failed = await runAdaptiveReview({ diff: DIFF, sandboxPath: null }, { onCheckpoint: (checkpoint) => { saved = checkpoint; } });
	expect(failed.assignments.find((record) => record.id === 'patterns-core')?.status).toBe('error');
	expect(first).toContain('patterns');

	const second: string[] = [];
	stubModel(second, 'ok');
	const resumed = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, resume: saved });
	expect(second).toEqual(['patterns', 'consolidation']);
	expect(resumed.assignments.map((record) => record.status)).toEqual(['done', 'done']);
	expect(resumed.findings.map((finding) => finding.message)).toEqual(['[bug] possible miss']);
});

test('a review whose consolidation fails still finishes with its findings', async () => {
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'test', label: 'Test', model: 'test' }] });
	const calls: string[] = [];
	stubModel(calls, 'ok');
	const answer = globalThis.fetch;
	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		const system = String(JSON.parse(String(init?.body)).messages[0]?.content ?? '');
		if (!system.includes('review orchestrator') && !system.includes('(correctness)') && !system.includes('(patterns)')) {
			return Response.json({ choices: [{ message: { content: 'not json' } }] });
		}
		return answer(url, init);
	}) as unknown as typeof fetch;
	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });
	expect(result.outcome).toBe('complete');
	expect(result.findings.map((finding) => finding.message)).toEqual(['[bug] possible miss']);
	expect(result.assignments.every((record) => record.status === 'done')).toBe(true);
});

test('the orchestrator can retry a specialist that failed', async () => {
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'test', label: 'Test', model: 'test' }] });
	const calls: string[] = [];
	let patternsCalls = 0;
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const messages = JSON.parse(String(init?.body)).messages as { content: string }[];
		const system = String(messages[0]?.content ?? '');
		const retryPass = messages.some((message) => message.content.includes('Specialists that failed'));
		const kind = system.includes('review orchestrator') ? (retryPass ? 'retry-planner' : 'planner')
			: system.includes('(patterns)') ? 'patterns'
			: system.includes('(correctness)') ? 'correctness'
			: 'consolidation';
		calls.push(kind);
		if (kind === 'patterns' && ++patternsCalls === 1) return new Response('bad request', { status: 400 });
		const reply = kind === 'planner' ? PLAN
			: kind === 'retry-planner' ? { ...PLAN, assignments: [assignment('retry-patterns-core', 'patterns', 2)] }
			: kind === 'consolidation' ? { keep: [], merge: [], reject: [], recommendedChecks: [] }
			: NOTHING;
		return Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'ok', ...reply }) } }] });
	}) as unknown as typeof fetch;
	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });
	expect(calls.filter((kind) => kind === 'retry-planner')).toHaveLength(1);
	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([
		['correctness-core', 'done'], ['patterns-core', 'error'], ['retry-patterns-core', 'done']
	]);
});

test('a follow-up reusing a launched assignment id gets its own id', () => {
	const follow = [assignment('patterns-core', 'patterns', 3), assignment('follow-x', 'security', 4), assignment('follow-x', 'security', 5)];
	expect(uniqueIds(follow, ['patterns-core', 'follow-patterns-core', 'follow-x']).map((item) => item.id))
		.toEqual(['follow-patterns-core-2', 'follow-x-2', 'follow-x-3']);
});
