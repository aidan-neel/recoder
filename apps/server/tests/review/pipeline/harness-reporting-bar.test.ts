import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { addedFile, finding, restoreAfterEach, stubFindings } from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-harness-bar-'));
});

const DIFF = addedFile('src/a.ts', 5);

test('a low-severity bug where code cannot run is held back unverified and counted under severity in the funnel', async () => {
	let verifiers = 0;

	stubFindings([{ ...finding('quiet problem', 'low'), line: 1 }], () => verifiers++);

	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });

	expect(verifiers).toBe(0);
	expect(result.findings).toEqual([]);
	expect(result.unconfirmed).toEqual([]);
	expect(result.funnel).toMatchObject({ raised: 1, unproven: 0, verified: 0, shown: 0 });
	expect(result.funnel?.dropped.severity).toBe(1);
});
