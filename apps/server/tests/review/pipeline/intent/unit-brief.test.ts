import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configForOrchestrator } from '../../../../src/models/models';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { briefUnit } from '../../../../src/review/pipeline/intent/unit-brief';
import { partitionUnits } from '../../../../src/review/pipeline/units';
import { addedFile, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';

restoreAfterEach();

let calls = 0;

/** Answers every call with `reply`, counting the calls. */
function stub(reply: unknown): void {
	globalThis.fetch = (async () => {
		calls++;

		return modelReply(reply);
	}) as unknown as typeof fetch;
}

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-unit-brief-'));
	useTestModel();
	calls = 0;
});

/** Briefs the first unit of a diff that adds `src/a.ts`. */
async function brief(diff = addedFile('src/a.ts', 10)) {
	const run = createRun({ diff, sandboxPath: null });

	return briefUnit(run, configForOrchestrator(), partitionUnits(run.inventory)[0]);
}

const cached = () => readdirSync(join(process.env.RECODER_DATA_DIR!, 'cache', 'intent'));

test('a reply whose every statement is about a file outside the unit is a placeholder, asked again and never cached', async () => {
	stub({ summary: 'Real summary.', observedChanges: [{ text: 'Wrong file', file: 'src/zzz.ts', line: 1 }] });

	const result = await brief();

	expect(calls).toBe(2);
	expect(result.record).toMatchObject({ status: 'omitted', reason: 'model' });
	expect(result.observed).toEqual([]);
	expect(cached()).toEqual([]);
});
