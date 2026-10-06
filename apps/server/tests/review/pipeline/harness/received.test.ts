import { describe, expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import type { EvidenceStore } from '../../../../src/evidence/evidence';
import type { EvidenceRecord } from '../../../../src/evidence/types';
import { unitContextParts } from '../../../../src/review/pipeline/change-model/lookup';
import type { ChangeModel } from '../../../../src/review/pipeline/change-model/types';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import {
	capturePrompt,
	emptyReceived,
	receivedOf,
	recordingReads,
	reviewContext,
	type Received
} from '../../../../src/review/pipeline/harness/received';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import type { ReviewUnit } from '../../../../src/review/pipeline/units';
import { candidate, patchPage, published, record, storeOf, tool } from './received-fixtures';

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
const HUNK = 'src/a.ts:1,2:1,3';

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

const unit = (lens: 'correctness' | 'security' = 'correctness'): ReviewUnit => ({
	id: `unit-1/${lens}`,
	title: 'a',
	reason: 'r',
	scope: [{ path: 'src/a.ts', hunkIds: [] }],
	lens
});

/** Records the prompt `unit` was built with: the whole patch, and the model's block when one is given. */
function capture(received: Received, model: ChangeModel | null = null, reviewer = unit()): void {
	const declarations = model ? unitContextParts(model, reviewer.scope) : null;

	capturePrompt(received, reviewer, buildInventory(DIFF), declarations, [patchPage('src/a.ts', 'E1', [HUNK])]);
}

/** The reads one reviewer makes: its scoped patch, a file a size cap cut, a read inside the patch, then a run. */
function investigate(received: Received, evidence: EvidenceStore): number {
	let forwarded = 0;
	const events = recordingReads(received, evidence, { onTool: () => forwarded++ });

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

function modelOf(symbols: ReturnType<typeof symbol>[]): ChangeModel {
	return { symbols, byHunk: {}, baselines: [], unparsed: [] } as unknown as ChangeModel;
}

function sources(received: Received, evidence: EvidenceStore, candidates: CandidateFinding[], units = [unit()]) {
	return { units, roles: new Map(), received, evidence, candidates };
}

describe('recording reads', () => {
	test('keeps each finished reviewer retrieval as a place, and passes every event on', () => {
		const received = emptyReceived();

		expect(investigate(received, store())).toBe(7);

		expect(received.byAssignment[UNIT]).toEqual([
			{ action: 'readDiff', path: 'src/a.ts', startLine: 1, endLine: 3, evidenceId: 'E1', ok: true, truncated: false },
			{ action: 'readFile', path: 'src/b.ts', startLine: 10, endLine: 20, evidenceId: 'E2', ok: true, truncated: true },
			{ action: 'readFile', path: 'src/a.ts', startLine: 2, endLine: 2, evidenceId: 'E3', ok: true, truncated: false }
		]);

		expect(Object.keys(received.byAssignment).sort()).toEqual([UNIT, OTHER].sort());
	});

	test('counts reads past the cap instead of listing them', () => {
		const received = emptyReceived();
		const events = recordingReads(received, store(), undefined);

		for (let index = 0; index < 205; index++) events.onTool?.(tool(UNIT, 'search', { input: { action: 'search' } }));

		expect(received.byAssignment[UNIT]).toHaveLength(200);
		expect(received.dropped).toEqual({ [UNIT]: 5 });
	});

	test('a checkpoint keeps only the finished assignments, prompts and reads, as a copy', () => {
		const received = emptyReceived();

		capture(received);
		capture(received, null, unit('security'));
		investigate(received, store());

		const kept = receivedOf(received, new Set([UNIT]));

		expect(Object.keys(kept.prompts)).toEqual([UNIT]);
		expect(Object.keys(kept.byAssignment)).toEqual([UNIT]);
		expect(kept.prompts[UNIT]).toEqual(received.prompts[UNIT]);
		expect(kept.byAssignment[UNIT]).not.toBe(received.byAssignment[UNIT]);
	});
});

describe('the review context', () => {
	function build(findings: Finding[]) {
		const evidence = store();
		const received = emptyReceived();

		capture(received);
		investigate(received, evidence);

		const candidates = [
			candidate('c1', UNIT, ['E2']),
			candidate('c2', UNIT, ['E3', 'E4']),
			candidate('c3', UNIT, ['E5', 'E9'])
		];

		return reviewContext(sources(received, evidence, candidates), findings);
	}

	test('splits what the prompt gave, what the reviewer read and what it cited, with what a bound cut', () => {
		const context = build([]);

		expect(context.units).toEqual({
			'unit-1': { supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 3 }], omitted: [] }
		});

		expect(context.reviewers).toEqual([
			{
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
			},
			{
				assignmentId: OTHER,
				role: 'reviewer',
				read: [{ kind: 'source', path: 'src/c.ts', startLine: 1, endLine: 9 }],
				cited: [],
				omitted: []
			}
		]);
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
		const received = emptyReceived();
		const events = recordingReads(received, evidence, undefined);

		capture(received);
		events.onTool?.(tool(UNIT, 'readDiff', { evidenceId: 'E1' }));
		events.onTool?.(tool(UNIT, 'readDiff', { evidenceId: 'E3', cut: true }));

		const context = reviewContext(sources(received, evidence, []), []);

		expect(context.units['unit-1'].omitted).toEqual([]);

		expect(context.reviewers[0].omitted).toEqual([
			{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 2, reason: 'diff-cap' }
		]);
	});

	test('a cited place counts as supplied only when the prompt showed all its lines, not when it only named it', () => {
		const model = modelOf([
			{ ...symbol('f', 1, 'function f()'), references: [{ file: 'src/c.ts', line: 5, text: 'f();' }] } as never
		]);

		const evidence = store();
		const received = emptyReceived();
		const events = recordingReads(received, evidence, undefined);

		capture(received, model);

		for (const id of ['E1', 'E6', 'E7', 'E5', 'E8']) events.onTool?.(tool(UNIT, 'readFile', { evidenceId: id }));

		const cited = [candidate('c1', UNIT, ['E6', 'E7', 'E5', 'E8'])];
		const context = reviewContext(sources(received, evidence, cited), []);

		expect(context.reviewers[0].cited.map((item) => [item.path, item.endLine, item.via])).toEqual([
			['src/a.ts', 12, 'read'],
			['tests/a.test.ts', 5, 'read'],
			['src/c.ts', 9, 'read'],
			['src/c.ts', 5, 'supplied']
		]);
	});

	test('lenses given the same prompt share one stored copy, and a unit lists at most 50 omissions per reason', () => {
		const model = modelOf(
			Array.from({ length: 120 }, (_, index) =>
				symbol(`f${index}`, index * 3 + 1, `function f${index}(${'value: string, '.repeat(8)}last: number): void`)
			)
		);

		const received = emptyReceived();
		const lenses = [unit(), unit('security')];

		for (const lens of lenses) capture(received, model, lens);

		const context = reviewContext(sources(received, store(), [], lenses), []);

		expect(Object.keys(context.units)).toEqual(['unit-1']);
		expect(context.reviewers.map((reviewer) => reviewer.unit)).toEqual(['unit-1', 'unit-1']);

		const prompt = context.units['unit-1'];
		const cut = prompt.omitted.filter((item) => item.reason === 'context-cap').length;
		const shown = prompt.supplied.filter((item) => item.kind === 'source').length;

		expect(cut).toBe(50);
		expect(cut + (prompt.omittedPast?.['context-cap'] ?? 0)).toBe(120 - shown);
	});

	test('the record is the prompt as captured, not one rebuilt from a later change model', () => {
		const received = emptyReceived();

		capture(received, modelOf([symbol('f', 1, 'function f()')]));

		const resumed = receivedOf(structuredClone(received), new Set([UNIT]));
		const context = reviewContext(sources(resumed, store(), []), []);

		expect(context.units['unit-1'].supplied.map((item) => `${item.kind} ${item.symbol ?? ''}`)).toEqual([
			'diff ',
			'source f',
			'test f'
		]);
	});

	test('an assignment that never built a prompt has no unit, and one outside the known units still gets a record', () => {
		const received = emptyReceived();

		recordingReads(received, store(), undefined).onTool?.(tool('obligation-1', 'readFile', { evidenceId: 'E5' }));

		expect(reviewContext(sources(received, store(), []), []).reviewers).toEqual([
			{
				assignmentId: 'obligation-1',
				role: 'reviewer',
				read: [{ kind: 'source', path: 'src/c.ts', startLine: 1, endLine: 9 }],
				cited: [],
				omitted: []
			}
		]);
	});
});
