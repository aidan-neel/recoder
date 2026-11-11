import { expect, test } from 'bun:test';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { runSubagents } from '../../../../src/review/pipeline/harness/subagent-stage';
import { cutUnits } from '../../../../src/review/pipeline/harness/unit-stage';
import type { ChangeIntent } from '../../../../src/review/pipeline/intent/types';
import type { LensId } from '../../../../src/review/pipeline/lenses/types';
import { NOTHING, addedFile, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';
import { question } from '../question-fixtures';

restoreAfterEach();

/** The ids of the subagents a review that applies `lenses` (every lens when unset) plans for one open brief question. */
async function plannedFor(lenses?: LensId[]): Promise<string[]> {
	useTestModel();
	globalThis.fetch = (async () => modelReply({ message: 'ok', ...NOTHING })) as unknown as typeof fetch;

	const run = createRun({ diff: addedFile('src/a.ts', 5), sandboxPath: null, lenses });

	cutUnits(run);
	run.intent = { openQuestions: [question('Q1', 2)] } as unknown as ChangeIntent;

	await runSubagents(run);

	return (run.subagents.units ?? []).map((unit) => unit.id);
}

test('an open brief question gets no subagent under a selection with no lens that reports bugs', async () => {
	expect(await plannedFor(['readability', 'conventions'])).toEqual([]);
});

test('an open brief question gets its subagent under a selection with a lens that reports bugs', async () => {
	expect(await plannedFor(['readability', 'performance'])).toEqual(['subagent-1']);
});

test('an open brief question gets its subagent as before when no selection is given', async () => {
	expect(await plannedFor()).toEqual(['subagent-1']);
});
