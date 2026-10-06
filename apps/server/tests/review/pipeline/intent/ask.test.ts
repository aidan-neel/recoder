import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { configForOrchestrator } from '../../../../src/models/models';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { askBrief, type BriefCall } from '../../../../src/review/pipeline/intent/ask';
import { addedFile, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';

restoreAfterEach();

const schema = z.object({ summary: z.string().default('') });

/** A brief call whose placeholder is a `...` summary. */
const call = (
	version = 1,
	system = 'You write the brief a code change is reviewed against.'
): BriefCall<z.infer<typeof schema>> => ({
	label: 'unit-1',
	version,
	system,
	user: 'Files: src/a.ts',
	schema,
	placeholder: (reply) => /^[.…\s]*$/.test(reply.summary)
});

let calls = 0;

/** Answers the calls with `replies` in turn, repeating the last. */
function stub(...replies: unknown[]): void {
	globalThis.fetch = (async () =>
		modelReply(replies[Math.min(calls++, replies.length - 1)])) as unknown as typeof fetch;
}

const newRun = () => createRun({ diff: addedFile('src/a.ts', 10), sandboxPath: null });
const ask = (brief = call()) => askBrief(newRun(), configForOrchestrator(), brief);
const cached = () => readdirSync(join(process.env.RECODER_DATA_DIR!, 'cache', 'intent'));

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-ask-'));
	useTestModel();
	calls = 0;
	stub({ summary: 'Adds a.' });
});

test('with the model-call budget spent, the part is left out for budget without a call', async () => {
	const run = newRun();

	run.budget.limit = run.budget.used;

	expect(await askBrief(run, configForOrchestrator(), call())).toEqual({
		omitted: 'budget',
		detail: 'the model-call budget was spent'
	});

	expect(calls).toBe(0);
});

test('a placeholder twice is left out for the model and never cached', async () => {
	stub({ summary: '...' });

	expect(await ask()).toEqual({ omitted: 'model', detail: 'the model answered with a placeholder twice' });
	expect(calls).toBe(2);
	expect(cached()).toEqual([]);
});

test('a placeholder then a real answer keeps and caches the real one', async () => {
	stub({ summary: '…' }, { summary: 'Adds a.' });

	expect(await ask()).toEqual({ value: { summary: 'Adds a.' } });
	expect(await ask()).toEqual({ value: { summary: 'Adds a.' } });
	expect(calls).toBe(2);
});

test('a raised prompt version or changed prompt misses the cache, and the unchanged call hits it', async () => {
	await ask(call(1));
	await ask(call(2));
	expect(calls).toBe(2);

	await ask(call(1, 'A reworded prompt.'));
	expect(calls).toBe(3);

	await ask(call(1));
	await ask(call(2));
	expect(calls).toBe(3);
});
