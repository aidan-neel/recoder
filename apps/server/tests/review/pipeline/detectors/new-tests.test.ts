import { describe, expect, test } from 'bun:test';
import { addedSubclasses, weakInNewTests } from '../../../../src/review/pipeline/detectors/new-tests';

/** Head lines the base lacks count as added. */
function detect(base: string[], head: string[], source: string[] = []) {
	const known = new Set(base.map((line) => line.trim()));
	const added = new Set<number>();

	head.forEach((line, index) => {
		if (!known.has(line.trim())) added.add(index + 1);
	});

	const subclasses = addedSubclasses(
		new Map([['src/errors.ts', new Map(source.map((line, index) => [index + 1, line]))]])
	);

	return weakInNewTests(
		{ path: 'test/client.test.ts', base: base.join('\n'), head: head.join('\n'), added, visible: added },
		subclasses
	).map(({ title, line, suspected }) => ({ title, line, suspected }));
}

describe('weakInNewTests', () => {
	test('flags a reporting test that only checks something was printed', () => {
		const head = [
			"test('reports up to date installs', async () => {",
			'	await run();',
			'	expect(writes.length > 0).toBe(true);',
			'});'
		];

		expect(detect([], head)).toEqual([
			{ title: '`reports up to date installs` checks only that something was printed', line: 3, suspected: true }
		]);
	});

	test('flags a keeps-the-most-severe test that only counts the result', () => {
		const head = [
			"test('the cap keeps the most severe findings', () => {",
			'	expect(result.findings).toHaveLength(1);',
			'});'
		];

		expect(detect([], head)).toEqual([
			{
				title: '`the cap keeps the most severe findings` checks how many items remain, not which one',
				line: 2,
				suspected: true
			}
		]);
	});

	test('still flags the count when the test also checks an unrelated status', () => {
		const head = [
			"test('the cap keeps the most severe findings', () => {",
			"	expect(result.status).toBe('complete');",
			'	expect(result.findings).toHaveLength(1);',
			'});'
		];

		expect(detect([], head).map(({ line }) => line)).toEqual([3]);
	});

	test('flags a count an added test checks only from below', () => {
		const head = [
			"test('retries until the budget runs out', async (t) => {",
			'\tawait run();',
			'\tt.true(requestCount >= 4);',
			'});'
		];

		expect(detect([], head)).toEqual([
			{ title: '`retries until the budget runs out` checks `requestCount` only from below', line: 3, suspected: true }
		]);
	});

	test('flags some in an added test whose title promises every item', () => {
		const head = [
			"it('pauses every timer', () => {",
			'\texpect(timers.some((timer) => timer.paused)).toBe(true);',
			'});'
		];

		expect(detect([], head)).toEqual([
			{ title: '`pauses every timer` checks only some items', line: 2, suspected: true }
		]);
	});

	test('flags a presence check on the error t.throwsAsync returned', () => {
		const head = [
			"test('abort rejects the caller', async (t) => {",
			'\tconst error = await t.throwsAsync(call());',
			'\tt.truthy(error);',
			'});'
		];

		expect(detect([], head)).toEqual([
			{ title: '`abort rejects the caller` never checks which error is thrown', line: 3, suspected: true }
		]);
	});

	test('flags a broad error class when the change adds a subclass the test never asserts', () => {
		const head = ["it('times out', async () => {", '\texpect(reason).toBeInstanceOf(HTTPException);', '});'];
		const source = ['export class TimeoutException extends HTTPException {}'];

		expect(detect([], head, source)).toEqual([
			{ title: '`times out` accepts any `HTTPException`', line: 2, suspected: true }
		]);
	});

	test('ignores a broad error class in a test about that class', () => {
		const head = [
			"it('extends HTTPException', () => {",
			'\texpect(new TimeoutException()).toBeInstanceOf(HTTPException);',
			'});'
		];

		const source = ['export class TimeoutException extends HTTPException {}'];

		expect(detect([], head, source)).toEqual([]);
	});

	test('ignores tests that already existed at the merge base', () => {
		const base = ["test('retries', async (t) => {", '\tt.is(requestCount, 4);', '});'];
		const head = ["test('retries', async (t) => {", '\tt.true(requestCount >= 4);', '});'];

		expect(detect(base, head)).toEqual([]);
	});
});
