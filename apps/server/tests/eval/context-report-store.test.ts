import { afterAll, afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContextOmission, ReviewToolCall } from '@recoder/shared';
import type { BenchmarkReport } from '../../src/eval/benchmark-report';
import { contextReport } from '../../src/eval/context-report';
import { EvidenceStore } from '../../src/evidence/evidence';
import {
	capturePrompt,
	emptyReceived,
	recordingReads,
	reviewContext
} from '../../src/review/pipeline/harness/received';
import { buildInventory } from '../../src/review/pipeline/inventory';
import { twoCommitRepo } from '../review/pipeline/harness-fixtures';

const originalFetch = globalThis.fetch;
const roots: string[] = [];

afterEach(() => {
	globalThis.fetch = originalFetch;
});

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const UNIT = { id: 'unit-1/correctness', title: 'a', reason: 'r', scope: [{ path: 'src/a.ts', hunkIds: [] }] };
const BASE = Array.from({ length: 320 }, (_, index) => `export const line${index + 1} = ${index + 1};`);

/** A declaration the block's size cap left out, between the two hunks at the head. */
const DECLARATION: ContextOmission = {
	kind: 'source',
	path: 'src/a.ts',
	startLine: 100,
	endLine: 120,
	symbol: 'between',
	reason: 'context-cap'
};

/**
 * A real two-hunk change (line 3, and line 300 before the first hunk grows)
 * reviewed through a real evidence store: the initial patch page (cut when
 * the first hunk is large), then the reviewer's own reads of head lines. One
 * candidate cites the page and every own read; returns the report's
 * cut-then-cited line.
 */
async function citedOmitted(options: {
	cut: boolean;
	declaration?: ContextOmission;
	ownRead?: (second: number) => [number, number];
}): Promise<string | undefined> {
	const root = mkdtempSync(join(tmpdir(), 'context-store-'));

	roots.push(root);

	const grown = Array.from(
		{ length: options.cut ? 600 : 2 },
		(_, index) => `export const grown${index} = '${'x'.repeat(40)}';`
	);

	const head = [...BASE.slice(0, 2), ...grown, ...BASE.slice(3, 299), 'export const line300 = 0;', ...BASE.slice(300)];

	const { targetSha, headSha } = await twoCommitRepo(root, {
		base: { 'src/a.ts': `${BASE.join('\n')}\n` },
		head: { 'src/a.ts': `${head.join('\n')}\n` }
	});

	const diff = execFileSync('git', ['-C', root, 'diff', targetSha, headSha], { encoding: 'utf8' });
	const inventory = buildInventory(diff);
	const revision = { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' };
	const evidence = new EvidenceStore(revision, inventory, 1000);
	const received = emptyReceived();
	const events = recordingReads(received, evidence, undefined);
	const onTool = (call: ReviewToolCall) => events.onTool?.({ ...call, assignmentId: UNIT.id, role: 'reviewer' });
	const patch = await evidence.executeRound([{ action: 'readDiff', path: 'src/a.ts' }], undefined, onTool, 1);

	expect(patch[0].truncated ?? false).toBe(options.cut);

	const declarations = { supplied: [], omitted: options.declaration ? [options.declaration] : [] };

	capturePrompt(received, UNIT, inventory, declarations, patch);

	const second = inventory.files[0].hunks[1].newStart;
	const reads = options.ownRead ? [options.ownRead(second)] : [];

	const own = await evidence.executeRound(
		reads.map(([startLine, endLine]) => ({
			action: 'readFile',
			revision: 'head',
			path: 'src/a.ts',
			startLine,
			endLine
		})),
		undefined,
		onTool,
		1
	);

	const evidenceIds = [...patch, ...own].flatMap((result) => (result.evidenceId ? [result.evidenceId] : []));

	const context = reviewContext(
		{
			units: [UNIT],
			roles: new Map(),
			received,
			evidence,
			candidates: [{ candidateId: 'c1', assignmentId: UNIT.id, evidenceIds }] as never
		},
		[{ id: 'f1', memberIds: ['c1'] }] as never
	);

	globalThis.fetch = (async () => Response.json({ id: 'r1', context })) as unknown as typeof fetch;

	const report = {
		dataset: 'store',
		prs: [{ codebase: 'a', runs: [{ index: 0, reviewId: 'r1', outcome: 'passed' }] }]
	};

	const lines = await contextReport(report as unknown as BenchmarkReport, 'http://localhost:3085');

	return lines.find((line) => line.includes('cut from the prompt, then cited'))?.trim();
}

test('a cut patch page cited as is does not count the hunks it left out as cut and then cited', async () => {
	expect(await citedOmitted({ cut: true })).toBe('cut from the prompt, then cited 0');
});

test('a hunk the cut page left out counts once the reviewer reads and cites it', async () => {
	const line = await citedOmitted({ cut: true, ownRead: (second) => [second - 2, second + 2] });

	expect(line).toBe('cut from the prompt, then cited 1 (diff-cap 1)');
});

test('an uncut page cited as is does not count a declaration cut from between its hunks', async () => {
	expect(await citedOmitted({ cut: false, declaration: DECLARATION })).toBe('cut from the prompt, then cited 0');
});

test('that declaration counts once the reviewer reads and cites it', async () => {
	const line = await citedOmitted({ cut: false, declaration: DECLARATION, ownRead: () => [100, 120] });

	expect(line).toBe('cut from the prompt, then cited 1 (context-cap 1)');
});
