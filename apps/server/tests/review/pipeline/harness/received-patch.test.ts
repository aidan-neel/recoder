import { expect, test } from 'bun:test';
import type { ToolResult } from '../../../../src/evidence/types';
import {
	capturePrompt,
	emptyReceived,
	recordingReads,
	reviewContext
} from '../../../../src/review/pipeline/harness/received';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { candidate, patchPage, published, record, storeOf, tool } from './received-fixtures';

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

const UNIT = { id: 'unit-1/correctness', title: 'a', reason: 'r', scope: [{ path: 'src/a.ts', hunkIds: [] }] };
const FIRST = 'src/a.ts:2,3:2,4';
const SECOND = 'src/a.ts:299,3:300,4';

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

/** The unit's record after its initial patch page and then its own reads, all cited by one candidate. */
function received(page: ToolResult, own: string[]) {
	const evidence = storeOf(DIFF, RECORDS);
	const state = emptyReceived();
	const events = recordingReads(state, evidence, undefined);

	events.onTool?.(tool(UNIT.id, 'readDiff', { evidenceId: page.evidenceId, ...(page.truncated ? { cut: true } : {}) }));
	capturePrompt(state, UNIT, buildInventory(DIFF), null, [page]);

	for (const id of own)
		events.onTool?.(tool(UNIT.id, id.startsWith('P') ? 'readDiff' : 'readFile', { evidenceId: id }));

	return reviewContext(
		{
			units: [UNIT],
			roles: new Map(),
			received: state,
			evidence,
			candidates: [candidate('c1', UNIT.id, ['P1', ...own])]
		},
		[published('f1', ['c1'])]
	);
}

const prompt = (context: ReturnType<typeof received>) => context.units[context.reviewers[0].unit ?? ''];

const via = (context: ReturnType<typeof received>) =>
	context.reviewers[0].cited.map((item) => `${item.kind} ${item.path}:${item.startLine}-${item.endLine} ${item.via}`);

test('each hunk is its own supplied range, and only reads inside one count as supplied', () => {
	const context = received(patchPage('src/a.ts', 'P1', [FIRST, SECOND]), ['W', 'M', 'I', 'P2']);

	expect(prompt(context).supplied).toEqual([
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

	expect(prompt(context).omitted).toEqual([]);
	expect(context.reviewers[0].read).toHaveLength(4);
});

test('a cut first page supplies only the hunks it delivered and omits the rest', () => {
	const context = received(patchPage('src/a.ts', 'P1', [FIRST], true), ['P2']);

	expect(prompt(context).supplied).toEqual([{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 5 }]);
	expect(via(context)).toEqual(['diff src/a.ts:2-5 supplied', 'diff src/a.ts:300-303 read']);

	expect(prompt(context).omitted).toEqual([
		{ kind: 'diff', path: 'src/a.ts', startLine: 300, endLine: 303, reason: 'diff-cap' }
	]);
});

test("the review's repro: whole-file, off-hunk and second-page reads are read, not supplied", () => {
	const context = received(patchPage('src/a.ts', 'P1', [FIRST], true), ['W', 'M', 'P2', 'O']);

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
