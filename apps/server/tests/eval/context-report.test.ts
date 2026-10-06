import { afterEach, expect, test } from 'bun:test';
import type { ReviewContext } from '@recoder/shared';
import type { BenchmarkReport } from '../../src/eval/benchmark-report';
import { contextReport } from '../../src/eval/context-report';
import { BIG, SMALL, STUB_REPORT } from './context-report-fixtures';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const CONTEXT: ReviewContext = {
	units: {
		'unit-1': {
			supplied: [
				{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 4 },
				{ kind: 'caller', path: 'src/b.ts', startLine: 9, symbol: 'take', why: 'call outside the diff' },
				{ kind: 'contract', path: 'src/a.ts', startLine: 1, symbol: 'take', why: 'signature or export changed' }
			],
			omitted: [{ kind: 'caller', path: 'src/d.ts', startLine: 2, symbol: 'take', reason: 'caller-cap' }]
		}
	},
	reviewers: [
		{
			assignmentId: 'unit-1/correctness',
			role: 'reviewer',
			lens: 'correctness',
			unit: 'unit-1',
			read: [{ kind: 'source', path: 'src/c.ts', startLine: 1, endLine: 40 }],
			cited: [
				{ kind: 'source', path: 'src/a.ts', startLine: 2, endLine: 2, via: 'supplied' },
				{ kind: 'source', path: 'src/c.ts', startLine: 3, endLine: 3, via: 'read' }
			],
			omitted: [{ kind: 'source', path: 'src/c.ts', startLine: 1, endLine: 40, reason: 'file-cap' }],
			readsDropped: 2
		}
	],
	findings: [
		{ findingId: 'f1', cited: { supplied: 2, read: 0, unknown: 0 }, members: 1, readBy: 0 },
		{ findingId: 'f2', cited: { supplied: 1, read: 1, unknown: 0 }, members: 2, readBy: 1 },
		{ findingId: 'f3', cited: { supplied: 0, read: 1, unknown: 1 }, members: 1, readBy: 1 },
		{ findingId: 'f4', cited: { supplied: 0, read: 0, unknown: 0 }, members: 1, readBy: 0 }
	]
};

function run(reviewId: string, outcome: 'passed' | 'failed') {
	return { index: 0, reviewId, outcome };
}

const REPORT = {
	dataset: 'frozen',
	prs: [
		{ codebase: 'beta', runs: [run('r1', 'passed'), run('r2', 'failed')] },
		{ codebase: 'alpha', runs: [run('r3', 'passed'), run('r4', 'passed'), run('gone', 'passed')] }
	]
} as unknown as BenchmarkReport;

test('totals what reviewers received by codebase and over all, from passed runs only, without paths', async () => {
	const fetched: string[] = [];

	globalThis.fetch = (async (url: RequestInfo | URL) => {
		const id = String(url).split('/').at(-1)!;

		fetched.push(id);

		if (id === 'gone') return Response.json({ error: 'not found' }, { status: 404 });

		return Response.json({ id, ...(id === 'r4' ? {} : { context: CONTEXT }) });
	}) as unknown as typeof fetch;

	const lines = await contextReport(REPORT, 'http://localhost:3085');

	expect(fetched).toEqual(['r1', 'r3', 'r4', 'gone']);

	expect(lines).toEqual([
		'Context received by reviewers in frozen (1 unreadable review)',
		'',
		'alpha  runs 2 (1 recorded)  reviewers 1',
		'  supplied 3 (diff 1, caller 1, contract 1)',
		"    cited by none of the reviewer's candidates 2",
		'  read 1 (+2 past the cap)',
		'  cited 2 (supplied 1, read 1, unknown 0)',
		'  omitted contract-unchanged 0, caller-cap 1, reference-cap 0, test-cap 0, context-cap 0, file-cap 1, diff-cap 0',
		'    cut from the prompt, then cited 0',
		'  published findings 4: backed by a read 50%, citing nothing held 25%',
		'    their citations supplied 3, read 2, unknown 1',
		'',
		'beta  runs 1 (1 recorded)  reviewers 1',
		'  supplied 3 (diff 1, caller 1, contract 1)',
		"    cited by none of the reviewer's candidates 2",
		'  read 1 (+2 past the cap)',
		'  cited 2 (supplied 1, read 1, unknown 0)',
		'  omitted contract-unchanged 0, caller-cap 1, reference-cap 0, test-cap 0, context-cap 0, file-cap 1, diff-cap 0',
		'    cut from the prompt, then cited 0',
		'  published findings 4: backed by a read 50%, citing nothing held 25%',
		'    their citations supplied 3, read 2, unknown 1',
		'',
		'all  runs 3 (2 recorded)  reviewers 2',
		'  supplied 6 (diff 2, caller 2, contract 2)',
		"    cited by none of the reviewer's candidates 4",
		'  read 2 (+4 past the cap)',
		'  cited 4 (supplied 2, read 2, unknown 0)',
		'  omitted contract-unchanged 0, caller-cap 2, reference-cap 0, test-cap 0, context-cap 0, file-cap 2, diff-cap 0',
		'    cut from the prompt, then cited 0',
		'  published findings 8: backed by a read 50%, citing nothing held 25%',
		'    their citations supplied 6, read 4, unknown 2',
		'',
		'By lens over all codebases',
		'  correctness  reviewers 2  supplied 6 (uncited 4)  read 2  cited 4 (supplied 2, read 2, unknown 0)  omitted 4, then cited 0'
	]);

	expect(lines.join('\n')).not.toContain('src/');
});

test('groups the stub reviews by lens and counts cut context that was cited and supplied context that was not', async () => {
	const fetched: string[] = [];

	const stored: Record<string, object> = {
		'big-0': { context: BIG },
		'none-1': {},
		'small-1': { context: SMALL },
		'big-1': { context: BIG }
	};

	globalThis.fetch = (async (url: RequestInfo | URL) => {
		const id = String(url).split('/').at(-1)!;

		fetched.push(id);

		return stored[id] ? Response.json({ id, ...stored[id] }) : Response.json({ error: 'not found' }, { status: 404 });
	}) as unknown as typeof fetch;

	const lines = await contextReport(STUB_REPORT, 'http://localhost:3085');

	expect(fetched).toEqual(['big-0', 'none-1', 'small-1', 'missing-9']);

	expect(lines).toEqual([
		'Context received by reviewers in stub (1 unreadable review)',
		'',
		'alpha  runs 2 (1 recorded)  reviewers 16',
		'  supplied 32 (diff 16, caller 16)',
		"    cited by none of the reviewer's candidates 16",
		'  read 1',
		'  cited 17 (supplied 16, read 1, unknown 0)',
		'  omitted contract-unchanged 0, caller-cap 32, reference-cap 16, test-cap 0, context-cap 0, file-cap 0, diff-cap 0',
		'    cut from the prompt, then cited 1 (caller-cap 1)',
		'  published findings 1: backed by a read 100%, citing nothing held 0%',
		'    their citations supplied 1, read 1, unknown 0',
		'',
		'beta  runs 1 (1 recorded)  reviewers 1',
		'  supplied 1 (diff 1)',
		"    cited by none of the reviewer's candidates 1",
		'  read 2',
		'  cited 2 (supplied 0, read 2, unknown 0)',
		'  omitted contract-unchanged 0, caller-cap 0, reference-cap 0, test-cap 0, context-cap 0, file-cap 1, diff-cap 1',
		'    cut from the prompt, then cited 1 (diff-cap 1)',
		'  published findings 1: backed by a read 100%, citing nothing held 0%',
		'    their citations supplied 0, read 2, unknown 0',
		'',
		'all  runs 3 (2 recorded)  reviewers 17',
		'  supplied 33 (diff 17, caller 16)',
		"    cited by none of the reviewer's candidates 17",
		'  read 3',
		'  cited 19 (supplied 16, read 3, unknown 0)',
		'  omitted contract-unchanged 0, caller-cap 32, reference-cap 16, test-cap 0, context-cap 0, file-cap 1, diff-cap 1',
		'    cut from the prompt, then cited 2 (caller-cap 1, diff-cap 1)',
		'  published findings 2: backed by a read 100%, citing nothing held 0%',
		'    their citations supplied 1, read 3, unknown 0',
		'',
		'By lens over all codebases',
		'  api-contract  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0',
		'  concurrency  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0',
		'  conventions  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0',
		'  correctness  reviewers 3  supplied 5 (uncited 3)  read 3  cited 5 (supplied 2, read 3, unknown 0)  omitted 8, then cited 2 (caller-cap 1, diff-cap 1)',
		'  performance  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0',
		'  readability  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0',
		'  rules  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0',
		'  security  reviewers 2  supplied 4 (uncited 2)  read 0  cited 2 (supplied 2, read 0, unknown 0)  omitted 6, then cited 0'
	]);

	expect(lines.join('\n')).not.toContain('src/');
});
