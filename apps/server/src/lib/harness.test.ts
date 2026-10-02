import { afterEach, expect, test } from 'bun:test';
import { REVIEW_ROLES, type ReviewRole } from './roles';
import { resetLlmLimiter } from './llm';
import { getStoredSettings, setReviewOverrides } from './review-settings';
import { failedAssignments, runAdaptiveReview, unfinishedAssignments, uniqueIds, type ReviewProgressCheckpoint } from './harness';
import { ReviewControl, runWithReviewControl } from './review-control';
import { REVIEW_POLICY } from './review-policy';

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
	// The empty, read-nothing patterns answer is sent back once before it's accepted.
	expect(second).toEqual(['patterns', 'patterns', 'consolidation']);
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

test('a specialist that kept failing reruns on its own, told how it failed, and the orchestrator says so', async () => {
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'test', label: 'Test', model: 'test' }] });
	const prompts: string[] = [];
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const messages = JSON.parse(String(init?.body)).messages as { content: string }[];
		const system = String(messages[0]?.content ?? '');
		const user = String(messages[1]?.content ?? '');
		const firstPatterns = system.includes('(patterns)') && !user.includes('Retry:');
		if (system.includes('(patterns)')) prompts.push(user);
		// The first patterns specialist only ever narrates, the failure seen with small models.
		const reply = system.includes('review orchestrator') ? PLAN
			: firstPatterns ? {}
			: system.includes('Role:') ? NOTHING
			: { keep: [], merge: [], reject: [], recommendedChecks: [] };
		return Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'Reading the queue code.', ...reply }) } }] });
	}) as unknown as typeof fetch;
	const notes: string[] = [];
	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null }, { onMessage: (message) => { if (message.id.startsWith('message_retries_')) notes.push(message.text); } });
	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([
		['correctness-core', 'done'], ['patterns-core', 'error'], ['retry-patterns-core', 'done']
	]);
	expect(prompts.at(-1)).toContain('Retry: the first attempt failed');
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain('with a strict reply format');
});

test('a specialist that ran out of room is retried as two halves of its scope', () => {
	const item = { ...assignment('correctness-core', 'correctness', 1), scope: [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }, { path: 'src/b.ts', hunkIds: ['h3'] }] };
	const retries = failedAssignments([item], [{ id: 'correctness-core', role: 'correctness', title: 'c', reason: 'r', scope: [], status: 'error', currentOperation: 'Model output truncated at the output-token limit' }]);
	expect(retries.map((retry) => [retry.item.id, retry.item.scope])).toEqual([
		['retry-correctness-core-a', [{ path: 'src/a.ts', hunkIds: ['h1', 'h2'] }]],
		['retry-correctness-core-b', [{ path: 'src/b.ts', hunkIds: ['h3'] }]]
	]);
	expect(failedAssignments([item], [{ id: 'correctness-core', role: 'correctness', title: 'c', reason: 'r', scope: [], status: 'error', currentOperation: 'Review cancelled.' }])).toEqual([]);
});

test('a follow-up reusing a launched assignment id gets its own id', () => {
	const follow = [assignment('patterns-core', 'patterns', 3), assignment('follow-x', 'security', 4), assignment('follow-x', 'security', 5)];
	expect(uniqueIds(follow, ['patterns-core', 'follow-patterns-core', 'follow-x']).map((item) => item.id))
		.toEqual(['follow-patterns-core-2', 'follow-x-2', 'follow-x-3']);
});

test('a plan past the approval threshold waits for the developer, then runs every specialist', async () => {
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'test', label: 'Test', model: 'test' }] });
	const roles: ReviewRole[] = ['correctness', 'patterns', 'security', 'perf', 'errors', 'api', 'testing'];
	const plan = { ...PLAN, assignments: roles.map((role, index) => assignment(`${role}-core`, role, index + 1)), roleDecisions: REVIEW_ROLES.map((role) => ({ role, decision: roles.includes(role) ? 'selected' : 'not_needed', reason: 'r' })) };
	const ran = new Set<string>();
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = String(JSON.parse(String(init?.body)).messages[0]?.content ?? '');
		const role = /Role: .*\((\w+)\)/.exec(system)?.[1];
		if (role) ran.add(role);
		const reply = system.includes('review orchestrator') ? plan : role ? NOTHING : { keep: [], merge: [], reject: [], recommendedChecks: [] };
		return Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'ok', ...reply }) } }] });
	}) as unknown as typeof fetch;
	const control = new ReviewControl();
	const approvals: string[] = [];
	const result = await runWithReviewControl(control, () => runAdaptiveReview({ diff: DIFF, sandboxPath: null }, {
		onApproval: (approval) => {
			approvals.push(approval.status);
			// The developer answers a moment later; the review must be holding until then.
			if (approval.status === 'pending') setTimeout(() => expect(control.approve()).toBe(true), 20);
		}
	}));
	expect(approvals).toEqual(['pending', 'approved']);
	expect([...ran].sort()).toEqual([...roles].sort());
	expect(result.assignments.filter((record) => record.status === 'skipped')).toEqual([]);
});

test('a review that runs out of time finishes with the findings its specialists reported instead of failing', async () => {
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'test', label: 'Test', model: 'test' }] });
	// The review clock reads wall time minus paused time; a negative pause skews it forward.
	class SkewedClock extends ReviewControl {
		skew = 0;
		override pausedMs(): number { return super.pausedMs() - this.skew; }
	}
	const control = new SkewedClock();
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = String(JSON.parse(String(init?.body)).messages[0]?.content ?? '');
		if (system.includes('(patterns)')) {
			// Never answers. Once it is in flight, the review's deadline passes.
			control.skew = REVIEW_POLICY.analysisDeadlineMs + 5_000;
			return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
		}
		const reply = system.includes('review orchestrator') ? PLAN
			: { ...NOTHING, findings: [{ file: 'src/a.ts', line: 1, severity: 'medium', category: 'bug', body: 'possible miss', evidenceIds: [] }] };
		return Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'ok', ...reply }) } }] });
	}) as unknown as typeof fetch;
	const result = await runWithReviewControl(control, () => runAdaptiveReview({ diff: DIFF, sandboxPath: null, signal: control.abort.signal }));
	expect(result.outcome).toBe('complete');
	expect(result.summary).toContain('ran out of time');
	expect(result.findings.map((finding) => finding.message)).toEqual(['[bug] possible miss']);
	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([['correctness-core', 'done'], ['patterns-core', 'error']]);
});

test('a specialist whose retry also failed counts as one unfinished review, and one whose retry finished counts as none', () => {
	const record = (id: string, status: 'done' | 'error' | 'skipped') => ({ id, role: 'correctness' as const, title: id, reason: 'r', scope: [], status });
	expect(unfinishedAssignments([record('a', 'error'), record('retry-a', 'error'), record('b', 'error'), record('retry-b', 'done'), record('c', 'skipped')]).map((item) => item.id)).toEqual(['retry-a']);
	expect(unfinishedAssignments([record('d', 'error'), record('retry-d-a', 'done'), record('retry-d-b', 'error')]).map((item) => item.id)).toEqual(['retry-d-b']);
});
