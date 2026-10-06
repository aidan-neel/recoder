import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configForOrchestrator } from '../../../../src/models/models';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { briefUnit } from '../../../../src/review/pipeline/intent/unit-brief';
import { partitionUnits } from '../../../../src/review/pipeline/units';
import { addedFile, messagesOf, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';

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

const A = addedFile('src/a.ts', 10);

/** Briefs the first unit of `diff` at the head commit `headSha`, when one is given. */
async function brief(diff = A, headSha?: string) {
	const run = createRun({ diff, sandboxPath: null });

	if (headSha) run.input.revision = { headSha, mergeBaseSha: 'BASE' } as typeof run.input.revision;

	return briefUnit(run, configForOrchestrator(), partitionUnits(run.inventory)[0], 1);
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

test('a placeholder is asked again once with a note, and a real answer then is kept and cached', async () => {
	const users: string[] = [];

	const replies = [
		{ summary: '...' },
		{ summary: 'Adds a.', observedChanges: [{ text: 'Adds a', file: 'src/a.ts', line: 1 }] }
	];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		users.push(String(messagesOf(init)[1]?.content ?? ''));

		return modelReply(replies[users.length - 1]);
	}) as unknown as typeof fetch;

	const result = await brief();

	expect(users).toHaveLength(2);
	expect(users[1]).toContain('A previous reply to this was a placeholder');
	expect(result.record).toMatchObject({ status: 'included', summary: 'Adds a.' });
	expect(cached()).toHaveLength(1);
});

test('the same diff at a moved head reads the cache and pins its claims to the new head', async () => {
	stub({ summary: 'Adds a.', observedChanges: [{ text: 'Adds a', file: 'src/a.ts', line: 1 }] });

	const first = await brief(A, 'HEAD1');
	const second = await brief(A, 'HEAD2');

	expect(calls).toBe(1);
	expect(first.observed[0].revision).toBe('HEAD1');
	expect(second.observed[0].revision).toBe('HEAD2');
	expect(second.record).toEqual(first.record);
});
