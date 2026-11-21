import { beforeEach, expect, test } from 'bun:test';
import { createRun } from '../../../src/review/pipeline/harness/context';
import { deduplicatePublished } from '../../../src/review/pipeline/harness/duplicate-stage';
import { envFlag } from '../../helpers/env-flag';
import { equivalentVote, provenFinding } from './duplicate-fixtures';
import { modelReply, restoreAfterEach, useTestModel } from './harness-fixtures';

envFlag('RECODER_PRECISION_FIXES', '1');
restoreAfterEach();

let calls = 0;
let reply: unknown;

beforeEach(() => {
	useTestModel();
	calls = 0;
	reply = { pairs: [equivalentVote('p0')] };

	globalThis.fetch = (async () => {
		calls++;

		return modelReply(reply);
	}) as unknown as typeof fetch;
});

const newRun = () => createRun({ diff: '', sandboxPath: null });
const findings = () => [provenFinding('a'), provenFinding('b')];

test('the stage performs one bounded call and accounts it without changing the candidate proofs', async () => {
	const run = newRun();
	const originals = findings();
	const result = await deduplicatePublished(run, originals);

	expect(calls).toBe(1);
	expect(run.budget.used).toBe(1);
	expect(result).toHaveLength(1);
	expect(result[0].verification).toBe(originals[0].verification);
});

test('a malformed answer keeps both reports and does not spend on schema retries', async () => {
	reply = { nonsense: true };

	const originals = findings();

	expect(await deduplicatePublished(newRun(), originals)).toEqual(originals);
	expect(calls).toBe(1);
});

test('a model error preserves already proven reports', async () => {
	globalThis.fetch = (async () =>
		Response.json({ error: { message: 'bad request' } }, { status: 400 })) as unknown as typeof fetch;

	const originals = findings();

	expect(await deduplicatePublished(newRun(), originals)).toEqual(originals);
});

test('empty input or an expired deadline retains findings without calling a model', async () => {
	const run = newRun();

	expect(await deduplicatePublished(run, [])).toEqual([]);
	run.deadlineAt = 0;
	expect(await deduplicatePublished(run, findings())).toEqual(findings());
	expect(calls).toBe(0);
});

test('the F opt-out makes no semantic consolidation call', async () => {
	process.env.RECODER_PRECISION_FIXES = '0';

	try {
		expect(await deduplicatePublished(newRun(), findings())).toEqual(findings());
		expect(calls).toBe(0);
	} finally {
		process.env.RECODER_PRECISION_FIXES = '1';
	}
});
