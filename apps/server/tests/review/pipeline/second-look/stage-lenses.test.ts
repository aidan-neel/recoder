import { expect, test } from 'bun:test';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { cutUnits } from '../../../../src/review/pipeline/harness/unit-stage';
import type { LensId } from '../../../../src/review/pipeline/lenses/types';
import { planSecondLook } from '../../../../src/review/pipeline/second-look/stage';
import { REPAIR_DIFF, candidateOf, repairContext, reported } from '../candidate-repair-fixtures';

/** A readability report of a stale comment on an added line, which a contract check would settle. */
const STALE_COMMENT = reported({ category: 'readability', smell: 'stale-comment', line: 14 });

/** The ids of the second looks `flag` turns on for a review that applies `lenses` (every lens when unset) and holds a stale-comment report. */
async function plannedFor(flag: 'RECODER_RESIDUAL' | 'RECODER_CONTRACT_CHECKS', lenses?: LensId[]): Promise<string[]> {
	const before = process.env[flag];

	process.env[flag] = '1';

	try {
		const run = createRun({ diff: REPAIR_DIFF, sandboxPath: null, lenses });

		cutUnits(run);
		run.candidates.push(candidateOf(STALE_COMMENT, 'readability', repairContext()));

		return (await planSecondLook(run, 4)).map((unit) => unit.id);
	} finally {
		if (before === undefined) delete process.env[flag];
		else process.env[flag] = before;
	}
}

test('a contract check is skipped under a selection no lens of which reports what it decides', async () => {
	expect(await plannedFor('RECODER_CONTRACT_CHECKS', ['readability', 'conventions'])).toEqual([]);
});

test('a contract check is kept under a selection with a lens that reports what it decides', async () => {
	expect(await plannedFor('RECODER_CONTRACT_CHECKS', ['readability', 'api-contract'])).toEqual(['contract-1']);
});

test('a contract check is planned as before when no selection is given', async () => {
	expect(await plannedFor('RECODER_CONTRACT_CHECKS')).toEqual(['contract-1']);
});

test('a residual pass is planned as before when no selection is given', async () => {
	expect(await plannedFor('RECODER_RESIDUAL')).toEqual(['residual-1', 'residual-2']);
});
