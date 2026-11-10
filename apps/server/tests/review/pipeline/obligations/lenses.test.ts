import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import type { LensId } from '../../../../src/review/pipeline/lenses/types';
import { restoreAfterEach, useTestModel } from '../harness-fixtures';
import { ANSWER, investigatorReply, isolateEachTest, riskyReview, stubInvestigations } from './fixtures';

restoreAfterEach();
isolateEachTest();

/** The obligations the risky change's investigators were launched for, when the review applies `lenses`. */
async function investigated(lenses: LensId[]): Promise<string[]> {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';

	const calls: string[] = [];

	stubInvestigations(calls, () => investigatorReply(ANSWER));

	const input = await riskyReview(mkdtempSync(join(tmpdir(), 'obligations-repo-')));

	await runAdaptiveReview({ ...input, lenses });

	return calls.filter((call) => call.startsWith('obligation-'));
}

test('an obligation is investigated only when the lens it belongs to is selected', async () => {
	expect(await investigated(['security'])).toHaveLength(2);
	expect(await investigated(['correctness'])).toHaveLength(2);
	expect(await investigated(['readability'])).toEqual([]);
});
