import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundOf } from '../../../src/review/pipeline/detectors/assertion-checks';
import { addedSubclasses, weakInNewTests } from '../../../src/review/pipeline/detectors/new-tests';
import { testBlocks, type Assertion } from '../../../src/review/pipeline/detectors/test-source';
import { weakenedInFile } from '../../../src/review/pipeline/detectors/weakened-tests';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { git } from '../../helpers/git';
import {
	NOTHING,
	confirmingVerifier,
	isVerifier,
	modelReply,
	restoreAfterEach,
	systemOf,
	twoCommitRepo,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

const original = { strength: process.env.RECODER_TEST_STRENGTH, exec: process.env.RECODER_EXEC };

afterEach(() => {
	if (original.strength === undefined) delete process.env.RECODER_TEST_STRENGTH;
	else process.env.RECODER_TEST_STRENGTH = original.strength;

	if (original.exec === undefined) delete process.env.RECODER_EXEC;
	else process.env.RECODER_EXEC = original.exec;
});

/** Sets or unsets `RECODER_TEST_STRENGTH` for the rest of the test. */
function flag(on: boolean): void {
	if (on) process.env.RECODER_TEST_STRENGTH = '1';
	else delete process.env.RECODER_TEST_STRENGTH;
}

/**
 * An AVA test file as a new test whose only assertion is `t.assert`. Every
 * flag-off value below was observed by running these same fixtures against
 * a573205, the commit before the test-strength work (#86) landed.
 */
const NEW_TEST = [
	"test('retries after a failure', async (t) => {",
	'\tawait run();',
	'\tt.assert(calls.length >= 1);',
	'});',
	''
].join('\n');

/** The same test as it was before the change: a `t.is` and the `t.assert` the change removes. */
const BASE_TEST = [
	"test('retries after a failure', async (t) => {",
	'\tawait run();',
	'\tt.is(status, 200);',
	'\tt.assert(calls.length >= 1);',
	'});',
	''
].join('\n');

const HEAD_TEST = [
	"test('retries after a failure', async (t) => {",
	'\tawait run();',
	'\tt.is(status, 200);',
	'});',
	''
].join('\n');

/** The new test with `t.true` in place of `t.assert`, which every version flags. */
const NEW_TEST_WITH_TRUE = NEW_TEST.replace('t.assert', 't.true');

/** A test file at the merge base and the head, with the head lines the base lacks as the added lines. */
function versions(base: string, head: string) {
	const known = new Set(base.split('\n').map((line) => line.trim()));
	const lines = head.split('\n');
	const added = new Set<number>();

	lines.forEach((line, index) => {
		if (line && !known.has(line.trim())) added.add(index + 1);
	});

	return { path: 'test/client.test.ts', base, head, added, visible: new Set(lines.map((_, index) => index + 1)) };
}

/** What both detectors say about a test file, as the title, line and whether each result is a suspicion. */
function detected(base: string, head: string) {
	const file = versions(base, head);

	return [...weakenedInFile(file), ...weakInNewTests(file, addedSubclasses(new Map()))].map(
		({ title, line, suspected }) => ({ title, line, suspected })
	);
}

/** How many assertions each test in the source has. */
function assertionCounts(source: string): number[] {
	return [...testBlocks(source).values()].map((block) => block.assertions.length);
}

const AVA_ASSERT: Assertion = {
	family: 'ava',
	text: 't.assert(calls.length >= 1)',
	modifiers: [],
	method: 'assert',
	args: ['calls.length >= 1'],
	startLine: 1,
	endLine: 1
};

describe('with RECODER_TEST_STRENGTH unset', () => {
	test('t.assert is not read as an assertion', () => {
		flag(false);

		expect(assertionCounts(NEW_TEST)).toEqual([0]);
		expect(assertionCounts(BASE_TEST)).toEqual([1]);
		expect(assertionCounts(HEAD_TEST)).toEqual([1]);
	});

	test('a new AVA test asserting t.assert(calls.length >= 1) gets no result', () => {
		flag(false);

		expect(detected('', NEW_TEST)).toEqual([]);
	});

	test('a removed t.assert line does not count as a lost assertion', () => {
		flag(false);

		expect(detected(BASE_TEST, HEAD_TEST)).toEqual([]);
	});

	test('t.assert is not a lower bound, as t.true still is', () => {
		flag(false);

		expect(boundOf(AVA_ASSERT)).toBeNull();

		expect(detected('', NEW_TEST_WITH_TRUE)).toEqual([
			{ title: '`retries after a failure` checks `calls.length` only from below', line: 3, suspected: true }
		]);
	});
});

describe('with RECODER_TEST_STRENGTH=1', () => {
	test('t.assert is read as an assertion', () => {
		flag(true);

		expect(assertionCounts(NEW_TEST)).toEqual([1]);
		expect(assertionCounts(BASE_TEST)).toEqual([2]);
		expect(assertionCounts(HEAD_TEST)).toEqual([1]);
	});

	test('a new AVA test asserting t.assert(calls.length >= 1) is a suspected lower bound', () => {
		flag(true);

		expect(detected('', NEW_TEST)).toEqual([
			{ title: '`retries after a failure` checks `calls.length` only from below', line: 3, suspected: true }
		]);
	});

	test('a removed t.assert line counts as a lost assertion', () => {
		flag(true);

		expect(detected(BASE_TEST, HEAD_TEST)).toEqual([
			{ title: '`retries after a failure` has fewer assertions', line: 1, suspected: true }
		]);
	});

	test('t.assert is a lower bound', () => {
		flag(true);

		expect(boundOf(AVA_ASSERT)).toEqual({ subject: 'calls.length', op: '>=', bound: '1' });
	});
});

/** The opening of the intent stage's system prompt. */
const INTENT_PROMPT = 'You write the brief a code change is reviewed against';

/**
 * Every call the review of a one-file change made at a573205 with code
 * execution off, sorted, apart from the intent brief `modelCalls` leaves out;
 * none was a verifier.
 */
const MODEL_CALLS_AT_A573205 = [
	'unit-1/api-contract',
	'unit-1/concurrency',
	'unit-1/conventions',
	'unit-1/correctness',
	'unit-1/performance',
	'unit-1/readability',
	'unit-1/rules',
	'unit-1/security'
];

/**
 * Reviews a repo whose head commit adds or edits an AVA test file, and returns
 * every model call, sorted, by assignment id, `verifier` or `other`. The intent
 * brief is left out: its answer is cached on disk under the diff, so only the
 * first review of a diff asks for it, whatever the flag.
 *
 * Code execution is turned off. Whether a host can run code (`bwrap` present
 * and permitted to unshare namespaces, or Seatbelt) decides whether the
 * correctness lens is sent back once for concluding without running anything
 * (`unrunCorrectnessFinal`), a second `unit-1/correctness` call that has
 * nothing to do with the flag, so the calls would differ between machines.
 */
async function modelCalls(files: { base?: Record<string, string>; head: Record<string, string> }): Promise<string[]> {
	useTestModel(4);
	process.env.RECODER_EXEC = 'off';

	const root = await mkdtemp(join(tmpdir(), 'recoder-test-strength-'));
	const calls: string[] = [];

	try {
		const { targetSha, headSha } = await twoCommitRepo(root, files);

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			if (systemOf(init).includes(INTENT_PROMPT)) return modelReply({ message: 'ok', ...NOTHING });

			calls.push(unitOf(init) ?? (isVerifier(init) ? 'verifier' : 'other'));

			return modelReply({ message: 'ok', ...((isVerifier(init) ? confirmingVerifier(init) : NOTHING) as object) });
		}) as unknown as typeof fetch;

		await runAdaptiveReview({
			diff: `${git(root, ['diff', targetSha, headSha])}\n`,
			sandboxPath: root,
			revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}

	return calls.sort();
}

const ADDED_TEST_FILE = { head: { 'test/client.test.ts': NEW_TEST } };
const EDITED_TEST_FILE = { base: { 'test/client.test.ts': BASE_TEST }, head: { 'test/client.test.ts': HEAD_TEST } };

describe('the model calls of a review', () => {
	test('with the flag unset, an added t.assert test makes the calls a573205 made', async () => {
		flag(false);

		expect(await modelCalls(ADDED_TEST_FILE)).toEqual(MODEL_CALLS_AT_A573205);
	});

	test('with the flag unset, a removed t.assert line makes the calls a573205 made', async () => {
		flag(false);

		expect(await modelCalls(EDITED_TEST_FILE)).toEqual(MODEL_CALLS_AT_A573205);
	});

	test('with the flag set, an added t.assert test also sends a verifier', async () => {
		flag(true);

		const calls = await modelCalls(ADDED_TEST_FILE);

		expect(calls.filter((call) => call !== 'verifier')).toEqual(MODEL_CALLS_AT_A573205);
		expect(calls).toContain('verifier');
	});

	test('with the flag set, a removed t.assert line also sends a verifier', async () => {
		flag(true);

		const calls = await modelCalls(EDITED_TEST_FILE);

		expect(calls.filter((call) => call !== 'verifier')).toEqual(MODEL_CALLS_AT_A573205);
		expect(calls).toContain('verifier');
	});
});
