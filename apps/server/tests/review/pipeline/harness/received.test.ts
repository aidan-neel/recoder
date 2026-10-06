import { describe, expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import type { EvidenceStore } from '../../../../src/evidence/evidence';
import type { EvidenceRecord } from '../../../../src/evidence/types';
import type { ChangeModel } from '../../../../src/review/pipeline/change-model/types';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import {
	emptyReads,
	readsOf,
	recordingReads,
	reviewContext,
	type ReceivedReads
} from '../../../../src/review/pipeline/harness/received';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import type { ReviewUnit } from '../../../../src/review/pipeline/units';
import { candidate, published, record, storeOf, tool } from './received-fixtures';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 keep
-old
+new
+more
`;

const UNIT = 'unit-1/correctness';
const OTHER = 'unit-1/security';

/**
 * E1 the scoped patch, E2 a file read a size cap cut, E3 a read inside the patch, E4 a run, E5 another reviewer's read,
 * E6 the changed declaration's body past the patch, E7 its test file, E8 the line of a listed reference.
 */
const RECORDS: EvidenceRecord[] = [
	record('E1', 'src/a.ts', 1, 3),
	record('E2', 'src/b.ts', 10, 20, { truncated: true }),
	record('E3', 'src/a.ts', 2, 2),
	record('E4', '.', 1, 1, { kind: 'run', command: 'bun test' }),
	record('E5', 'src/c.ts', 1, 9),
	record('E6', 'src/a.ts', 10, 12),
	record('E7', 'tests/a.test.ts', 1, 5),
	record('E8', 'src/c.ts', 5, 5)
];

function store(): EvidenceStore {
	return storeOf(DIFF, RECORDS);
}

/** The reads one reviewer makes: its scoped patch, a file a size cap cut, a read inside the patch, then a run. */
function investigate(reads: ReceivedReads, evidence: EvidenceStore): number {
	let forwarded = 0;
	const events = recordingReads(reads, evidence, { onTool: () => forwarded++ });

	events.onTool?.(tool(UNIT, 'readDiff', { status: 'running', result: undefined }));
	events.onTool?.(tool(UNIT, 'readDiff', { evidenceId: 'E1' }));
	events.onTool?.(tool(UNIT, 'readFile', { evidenceId: 'E2', cut: true }));
	events.onTool?.(tool(UNIT, 'readFile', { evidenceId: 'E3' }));
	events.onTool?.(tool(UNIT, 'run', { evidenceId: 'E4' }));
	events.onTool?.(tool(OTHER, 'readFile', { evidenceId: 'E5' }));
	events.onTool?.(tool(undefined, 'readFile', { evidenceId: 'E5' }));

	return forwarded;
}

/** A modified, unexported declaration in `src/a.ts` with a test file and no references. */
function symbol(name: string, startLine: number, signature: string) {
	return {
		id: `src/a.ts#${name}`,
		name,
		qualifiedName: name,
		kind: 'function',
		file: 'src/a.ts',
		startLine,
		endLine: startLine + 39,
		change: 'modified',
		hunkIds: [],
		language: 'typescript',
		signature,
		exported: false,
		calls: [],
		references: [],
		tests: ['tests/a.test.ts'],
		examples: [],
		metrics: { lines: 40, maxDepth: 1, params: 0 }
	};
}

describe('recording reads', () => {
	test('keeps each finished reviewer retrieval as a place, and passes every event on', () => {
		const reads = emptyReads();

		expect(investigate(reads, store())).toBe(7);

		expect(reads.byAssignment[UNIT]).toEqual([
			{ action: 'readDiff', path: 'src/a.ts', startLine: 1, endLine: 3, evidenceId: 'E1', ok: true, truncated: false },
			{ action: 'readFile', path: 'src/b.ts', startLine: 10, endLine: 20, evidenceId: 'E2', ok: true, truncated: true },
			{ action: 'readFile', path: 'src/a.ts', startLine: 2, endLine: 2, evidenceId: 'E3', ok: true, truncated: false }
		]);

		expect(Object.keys(reads.byAssignment).sort()).toEqual([UNIT, OTHER].sort());
	});

	test('counts reads past the cap instead of listing them', () => {
		const reads = emptyReads();
		const events = recordingReads(reads, store(), undefined);

		for (let index = 0; index < 205; index++) events.onTool?.(tool(UNIT, 'search', { input: { action: 'search' } }));

		expect(reads.byAssignment[UNIT]).toHaveLength(200);
		expect(reads.dropped).toEqual({ [UNIT]: 5 });
	});

	test('a checkpoint keeps only the finished assignments, as a copy', () => {
		const reads = emptyReads();

		investigate(reads, store());

		const kept = readsOf(reads, new Set([UNIT]));

		expect(Object.keys(kept.byAssignment)).toEqual([UNIT]);
		expect(kept.byAssignment[UNIT]).toEqual(reads.byAssignment[UNIT]);
		expect(kept.byAssignment[UNIT]).not.toBe(reads.byAssignment[UNIT]);
	});
});

describe('the review context', () => {
	const units: ReviewUnit[] = [
		{ id: UNIT, title: 'a', reason: 'r', scope: [{ path: 'src/a.ts', hunkIds: [] }], lens: 'correctness' }
	];

	function sources(
		reads: ReceivedReads,
		evidence: EvidenceStore,
		candidates: CandidateFinding[],
		changeModel: ChangeModel | null = null
	) {
		return {
			units,
			subagents: null,
			roles: new Map(),
			inventory: buildInventory(DIFF),
			changeModel,
			reads,
			evidence,
			candidates
		};
	}

	function build(findings: Finding[]) {
		const evidence = store();
		const reads = emptyReads();

		investigate(reads, evidence);

		const candidates = [
			candidate('c1', UNIT, ['E2']),
			candidate('c2', UNIT, ['E3', 'E4']),
			candidate('c3', UNIT, ['E5', 'E9'])
		];

		return reviewContext(sources(reads, evidence, candidates), findings);
	}

	test('splits what the prompt gave, what the reviewer read and what it cited, with what a bound cut', () => {
		const context = build([]);

		expect(context.units).toEqual({
			'unit-1': { supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 3 }], omitted: [] }
		});

		expect(context.reviewers[0]).toEqual({
			assignmentId: UNIT,
			role: 'reviewer',
			lens: 'correctness',
			unit: 'unit-1',
			read: [
				{ kind: 'source', path: 'src/b.ts', startLine: 10, endLine: 20 },
				{ kind: 'source', path: 'src/a.ts', startLine: 2, endLine: 2 }
			],
			cited: [
				{ kind: 'source', path: 'src/b.ts', startLine: 10, endLine: 20, via: 'read' },
				{ kind: 'source', path: 'src/a.ts', startLine: 2, endLine: 2, via: 'supplied' },
				{ kind: 'source', path: 'src/c.ts', startLine: 1, endLine: 9, via: 'unknown' }
			],
			omitted: [{ kind: 'source', path: 'src/b.ts', startLine: 10, endLine: 20, reason: 'file-cap' }]
		});
	});

	test('a published finding counts every way its members had their evidence, and how many read their own', () => {
		const { findings } = build([
			published('f1', ['c1']),
			published('f2', ['c1', 'c2']),
			published('c3'),
			published('f4', ['missing'])
		]);

		expect(findings).toEqual([
			{ findingId: 'f1', cited: { supplied: 0, read: 1, unknown: 0 }, members: 1, readBy: 1 },
			{ findingId: 'f2', cited: { supplied: 1, read: 1, unknown: 0 }, members: 2, readBy: 1 },
			{ findingId: 'c3', cited: { supplied: 0, read: 0, unknown: 1 }, members: 1, readBy: 0 },
			{ findingId: 'f4', cited: { supplied: 0, read: 0, unknown: 0 }, members: 0, readBy: 0 }
		]);
	});

	test("records a patch page a budget cut as a diff-cap omission of the reviewer's own read", () => {
		const evidence = store();
		const reads = emptyReads();
		const events = recordingReads(reads, evidence, undefined);

		events.onTool?.(tool(UNIT, 'readDiff', { evidenceId: 'E1' }));
		events.onTool?.(tool(UNIT, 'readDiff', { evidenceId: 'E3', cut: true }));

		const context = reviewContext(sources(reads, evidence, []), []);

		expect(context.units['unit-1'].omitted).toEqual([]);

		expect(context.reviewers[0].omitted).toEqual([
			{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 2, reason: 'diff-cap' }
		]);
	});

	test('lenses given the same prompt share one stored copy, and a unit lists at most 50 omissions per reason', () => {
		const declarations = Array.from({ length: 120 }, (_, index) =>
			symbol(`f${index}`, index * 3 + 1, `function f${index}(${'value: string, '.repeat(8)}last: number): void`)
		);

		const model = { symbols: declarations, byHunk: {}, baselines: [], unparsed: [] } as unknown as ChangeModel;
		const lenses = (['correctness', 'security'] as const).map((lens) => ({ ...units[0], id: `unit-1/${lens}`, lens }));
		const context = reviewContext({ ...sources(emptyReads(), store(), [], model), units: lenses }, []);

		expect(Object.keys(context.units)).toEqual(['unit-1']);
		expect(context.reviewers.map((reviewer) => reviewer.unit)).toEqual(['unit-1', 'unit-1']);

		const prompt = context.units['unit-1'];
		const cut = prompt.omitted.filter((item) => item.reason === 'context-cap').length;

		expect(cut).toBe(50);

		expect(cut + (prompt.omittedPast?.['context-cap'] ?? 0)).toBe(
			120 - prompt.supplied.filter((item) => item.kind === 'source').length
		);
	});

	test('a cited place counts as supplied only when the prompt showed all its lines, not when it only named it', () => {
		const model = {
			symbols: [{ ...symbol('f', 1, 'function f()'), references: [{ file: 'src/c.ts', line: 5, text: 'f();' }] }],
			byHunk: {},
			baselines: [],
			unparsed: []
		} as unknown as ChangeModel;

		const evidence = store();
		const reads = emptyReads();
		const events = recordingReads(reads, evidence, undefined);

		for (const id of ['E1', 'E6', 'E7', 'E5', 'E8']) events.onTool?.(tool(UNIT, 'readFile', { evidenceId: id }));

		const cited = [candidate('c1', UNIT, ['E6', 'E7', 'E5', 'E8'])];
		const context = reviewContext(sources(reads, evidence, cited, model), []);

		expect(context.reviewers[0].cited.map((item) => [item.path, item.endLine, item.via])).toEqual([
			['src/a.ts', 12, 'read'],
			['tests/a.test.ts', 5, 'read'],
			['src/c.ts', 9, 'read'],
			['src/c.ts', 5, 'supplied']
		]);
	});
});
