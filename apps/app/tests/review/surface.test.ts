import { describe, expect, test } from 'bun:test';
import type { FileDiff, Finding, Review } from '@recoder/shared';
import { buildSurface } from '../../src/lib/review/surface';
import { addedHunk } from '../fixtures';

function added(path: string, count: number): FileDiff {
	return {
		path,
		additions: count,
		deletions: 0,
		hunks: [
			{
				header: `@@ -0,0 +1,${count} @@`,
				oldStart: 0,
				oldCount: 0,
				newStart: 1,
				newCount: count,
				lines: Array.from({ length: count }, (_, i) => ({
					type: 'add' as const,
					oldNo: null,
					newNo: i + 1,
					text: `line ${i + 1}`
				}))
			}
		]
	};
}

/** A file whose changes sit in two hunks: lines 10-14 and 80-89. */
function twoHunks(path: string): FileDiff {
	return { path, additions: 15, deletions: 0, hunks: [addedHunk(10, 5), addedHunk(80, 10)] };
}

function finding(
	id: string,
	file: string,
	line: number,
	severity: Finding['severity'],
	extra: Partial<Finding> = {}
): Finding {
	return { id, file, line, severity, message: `[correctness] The parser drops ${id}. More detail.`, ...extra };
}

function review(findings: Finding[], extra: Partial<Review> = {}): Review {
	return {
		id: 'r1',
		repoId: 'repo',
		prNumber: 1,
		headSha: 'abc',
		status: 'passed',
		summary: 'Adds a thing.',
		findings,
		runs: [],
		source: 'github',
		prTitle: 'A thing',
		prUrl: null,
		createdAt: '',
		updatedAt: '',
		...extra
	};
}

describe('buildSurface', () => {
	test('orders decisions by severity, bugs before quality, proven before unproven', () => {
		const surface = buildSurface(
			review([
				finding('low', 'a.ts', 1, 'info'),
				finding('quality', 'a.ts', 2, 'warning', { category: 'readability' }),
				finding('unproven', 'a.ts', 3, 'warning'),
				finding('proven', 'a.ts', 4, 'warning', { verification: { status: 'verified', method: 'run', reason: '' } }),
				finding('high', 'a.ts', 5, 'error')
			]),
			[added('a.ts', 10)]
		);

		expect(surface.decisions.map((decision) => decision.id)).toEqual(['high', 'proven', 'unproven', 'quality', 'low']);
	});

	test('strips the category tag from the body and titles untitled findings from their first sentence', () => {
		const [decision] = buildSurface(review([finding('f', 'a.ts', 1, 'error')]), []).decisions;

		expect(decision.body).toBe('The parser drops f. More detail.');
		expect(decision.title).toBe('The parser drops f.');
	});

	test('asks a person to read only the changed lines around an open decision', () => {
		const surface = buildSurface(review([finding('f', 'a.ts', 50, 'error')]), [added('a.ts', 100)]);

		expect(surface.files[0]).toMatchObject({ cls: 'read', readLines: 21 });
		expect(surface.attention).toMatchObject({ read: 21, checked: 79, total: 100 });
	});

	test('never counts lines from a different hunk toward reading', () => {
		const surface = buildSurface(review([finding('f', 'a.ts', 82, 'error')]), [twoHunks('a.ts')]);

		expect(surface.files[0].readLines).toBe(10);
	});

	test('moves a decided item’s lines from read to checked', () => {
		const surface = buildSurface(review([finding('f', 'a.ts', 82, 'error')]), [twoHunks('a.ts')], { f: 'accepted' });

		expect(surface.files[0].cls).toBe('checked');
		expect(surface.attention).toMatchObject({ read: 0, checked: 15 });
		expect(surface.minutes).toBe(0);
	});

	test('sorts files without decisions into checked, tests and skim', () => {
		const surface = buildSurface(review([]), [
			added('src/a.ts', 4),
			added('tests/a.test.ts', 3),
			added('bun.lock', 2),
			added('README.md', 1)
		]);

		expect(surface.files.map((file) => file.cls)).toEqual(['checked', 'tests', 'skim', 'skim']);
		expect(surface.attention).toEqual({ read: 0, checked: 4, tests: 3, skim: 3, total: 10 });
	});

	test('sends a file no reviewer was given or read to a person', () => {
		const context = {
			units: { u1: { supplied: [{ kind: 'source' as const, path: 'src/seen.ts' }], omitted: [] } },
			reviewers: [],
			findings: []
		};

		const surface = buildSurface(review([], { context }), [added('src/seen.ts', 4), added('src/unseen.ts', 6)]);

		expect(surface.files.map((file) => [file.cls, file.examined])).toEqual([
			['checked', true],
			['read', false]
		]);

		expect(surface.attention.read).toBe(6);
	});

	test('marks no file checked while a review without a context record is still running', () => {
		const surface = buildSurface(review([], { status: 'running' }), [added('src/a.ts', 4)]);

		expect(surface.files.map((file) => [file.cls, file.examined])).toEqual([['read', false]]);
		expect(surface.attention.checked).toBe(0);
	});

	test('turns unresolved questions into decisions and disproved ones into receipts', () => {
		const source = { file: 'a.ts', line: 3 };
		const base = { owners: [], answers: [], followUps: [], source };

		const surface = buildSurface(
			review([], {
				questions: {
					counts: {
						asked: 2,
						confirmed: 0,
						disproved: 1,
						unresolved: 1,
						notApplicable: 0,
						followUpsRun: 0,
						followUpsNotRun: 0
					},
					questions: [
						{ ...base, id: 'Q1', question: 'Open?', result: 'unresolved', reason: 'No Redis.' },
						{ ...base, id: 'Q2', question: 'Safe?', result: 'disproved', reason: 'It is synchronous.' }
					]
				}
			}),
			[added('a.ts', 5)]
		);

		expect(surface.decisions.map((decision) => [decision.id, decision.tone])).toEqual([['question:Q1', 'question']]);

		expect(surface.receipts.map((receipt) => [receipt.id, receipt.reason])).toEqual([
			['question:Q2', 'It is synchronous.']
		]);
	});
});
