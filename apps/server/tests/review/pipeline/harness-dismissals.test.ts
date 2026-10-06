import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding } from '@recoder/shared';
import { recordDismissal } from '../../../src/review/guidelines/learned/dismissals';
import { dismissalKey } from '../../../src/review/guidelines/learned/finding-key';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { addedFile, finding, restoreAfterEach, stubFindings } from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-harness-dismissals-'));
});

const DIFF = addedFile('src/a.ts', 5);

/** Two findings in one file, on different lines, so they carry different text. */
function stubTwoFindings(): void {
	stubFindings([
		{ ...finding('first problem'), line: 1 },
		{ ...finding('second problem'), line: 2 }
	]);
}

const titles = (findings: Finding[]) => findings.map((entry) => entry.title).sort();

test('a candidate matching a finding dismissed in this repository is dropped as dismissed, and its neighbour in the file is kept', async () => {
	stubTwoFindings();

	const first = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-1' });
	const reported = [...first.findings, ...first.unconfirmed];

	expect(titles(reported)).toEqual(['first problem', 'second problem']);
	expect(first.funnel?.dropped.dismissed).toBe(0);

	const dismissed = reported.find((entry) => entry.title === 'first problem')!;

	recordDismissal({
		repoId: 'repo-1',
		fingerprint: dismissalKey(dismissed, DIFF),
		file: dismissed.file,
		category: 'correctness',
		title: 'first problem',
		dismissedAt: new Date().toISOString()
	});

	const again = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-1' });

	expect(titles([...again.findings, ...again.unconfirmed])).toEqual(['second problem']);
	expect(again.funnel?.dropped.dismissed).toBe(1);

	const otherRepo = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-2' });
	const bare = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });

	expect(otherRepo.funnel?.dropped.dismissed).toBe(0);
	expect(bare.funnel?.dropped.dismissed).toBe(0);
});

/** Two different defects reported on line 1, which consolidation keeps as two findings. */
function stubSplitLine(): void {
	stubFindings([
		{
			...finding('expired entry is served'),
			claim: {
				trigger: 'a second request reads the entry after it expired',
				executionPath: [],
				consequence: 'the caller gets a stale value',
				violatedContract: 'expired entries are never served'
			}
		},
		{
			...finding('index wraps around'),
			claim: {
				trigger: 'the loop runs past two billion iterations',
				executionPath: [],
				consequence: 'the counter turns negative and reads out of bounds',
				violatedContract: 'indexes stay inside the array'
			}
		}
	]);
}

/** Remembers `dismissed` under `fingerprint`, or under its own dismissal key. */
function dismiss(dismissed: Finding, fingerprint = dismissalKey(dismissed, DIFF)): void {
	recordDismissal({
		repoId: 'repo-1',
		fingerprint,
		file: dismissed.file,
		category: 'correctness',
		title: dismissed.title ?? '',
		dismissedAt: new Date().toISOString()
	});
}

test('dismissing one of two findings split from one line drops only that one in the next review', async () => {
	stubSplitLine();

	const first = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-1' });

	expect(titles(first.findings)).toEqual(['expired entry is served', 'index wraps around']);
	expect(new Set(first.findings.map((entry) => entry.line))).toEqual(new Set([1]));

	dismiss(first.findings.find((entry) => entry.title === 'index wraps around')!);

	const again = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-1' });

	expect(titles([...again.findings, ...again.unconfirmed])).toEqual(['expired entry is served']);
	expect(again.funnel?.dropped.dismissed).toBe(1);
});

test('a dismissal stored in the old place-only form is still read, and drops every finding at its place', async () => {
	stubSplitLine();

	const first = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-1' });
	const dismissed = first.findings[0];

	dismiss(dismissed, dismissalKey(dismissed, DIFF).split(':')[0]);

	const again = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, repoId: 'repo-1' });

	expect([...again.findings, ...again.unconfirmed]).toEqual([]);
	expect(again.funnel?.dropped.dismissed).toBe(2);
});
