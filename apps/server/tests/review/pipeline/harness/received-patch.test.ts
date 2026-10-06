import { expect, test } from 'bun:test';
import { emptyReads, recordingReads, reviewContext } from '../../../../src/review/pipeline/harness/received';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { candidate, published, record, storeOf, tool } from './received-fixtures';

/** Two hunks of one file, over new lines 2-5 and 300-303. */
const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -2,3 +2,4 @@
 a
-b
+c
+d
 e
@@ -299,3 +300,4 @@
 x
-y
+z
+w
 v
`;

const UNIT = 'unit-1/correctness';
const FIRST = 'src/a.ts:2,3:2,4';

/**
 * P1 the initial patch, P2 its second page, W the whole file, M a range in no hunk,
 * I a range inside the first hunk, O another file.
 */
const RECORDS = [
	record('P1', 'src/a.ts', 2, 5),
	record('P2', 'src/a.ts', 300, 303),
	record('W', 'src/a.ts', 1, 400),
	record('M', 'src/a.ts', 100, 150),
	record('I', 'src/a.ts', 3, 4),
	record('O', 'src/other.ts', 1, 50)
];

/** The unit's record after its initial patch read and then its own reads, each cited by one candidate. */
function received(patch: Parameters<typeof tool>[2], own: string[]) {
	const evidence = storeOf(DIFF, RECORDS);
	const reads = emptyReads();
	const events = recordingReads(reads, evidence, undefined);

	events.onTool?.(tool(UNIT, 'readDiff', patch));

	for (const id of own) events.onTool?.(tool(UNIT, id.startsWith('P') ? 'readDiff' : 'readFile', { evidenceId: id }));

	return reviewContext(
		{
			units: [{ id: UNIT, title: 'a', reason: 'r', scope: [{ path: 'src/a.ts', hunkIds: [] }], lens: 'correctness' }],
			subagents: null,
			roles: new Map(),
			inventory: buildInventory(DIFF),
			changeModel: null,
			reads,
			evidence,
			candidates: [candidate('c1', UNIT, ['P1', ...own])]
		},
		[published('f1', ['c1'])]
	);
}

const via = (context: ReturnType<typeof received>) =>
	context.reviewers[0].cited.map((item) => `${item.kind} ${item.path}:${item.startLine}-${item.endLine} ${item.via}`);

test('each hunk is its own supplied range, and only reads inside one count as supplied', () => {
	const context = received({ evidenceId: 'P1' }, ['W', 'M', 'I', 'P2']);

	expect(context.reviewers[0].supplied).toEqual([
		{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 5 },
		{ kind: 'diff', path: 'src/a.ts', startLine: 300, endLine: 303 }
	]);

	expect(via(context)).toEqual([
		'diff src/a.ts:2-5 supplied',
		'source src/a.ts:1-400 read',
		'source src/a.ts:100-150 read',
		'source src/a.ts:3-4 supplied',
		'diff src/a.ts:300-303 supplied'
	]);

	expect(context.reviewers[0].omitted).toEqual([]);
});

test('a cut first page supplies only the hunks it delivered and omits the rest', () => {
	const context = received({ evidenceId: 'P1', cut: true, shown: [FIRST] }, ['P2']);

	expect(context.reviewers[0].supplied).toEqual([{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 5 }]);
	expect(via(context)).toEqual(['diff src/a.ts:2-5 supplied', 'diff src/a.ts:300-303 read']);

	expect(context.reviewers[0].omitted).toEqual([
		{ kind: 'diff', path: 'src/a.ts', startLine: 300, endLine: 303, reason: 'diff-cap' }
	]);
});

test('a cut first page recorded without its delivered hunks supplies none of the file', () => {
	const context = received({ evidenceId: 'P1', cut: true }, ['I']);

	expect(context.reviewers[0].supplied).toEqual([]);
	expect(via(context)).toEqual(['diff src/a.ts:2-5 supplied', 'source src/a.ts:3-4 read']);

	expect(context.reviewers[0].omitted).toEqual([
		{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 5, reason: 'diff-cap' }
	]);
});

test("the review's repro: whole-file, off-hunk and second-page reads are read, not supplied", () => {
	const context = received({ evidenceId: 'P1', cut: true, shown: [FIRST] }, ['W', 'M', 'P2', 'O']);

	expect(via(context)).toEqual([
		'diff src/a.ts:2-5 supplied',
		'source src/a.ts:1-400 read',
		'source src/a.ts:100-150 read',
		'diff src/a.ts:300-303 read',
		'source src/other.ts:1-50 read'
	]);

	expect(context.findings).toEqual([
		{ findingId: 'f1', cited: { supplied: 1, read: 4, unknown: 0 }, members: 1, readBy: 1 }
	]);
});
