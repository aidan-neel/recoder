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
