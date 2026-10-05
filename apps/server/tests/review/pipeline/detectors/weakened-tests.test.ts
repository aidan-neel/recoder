import { describe, expect, test } from 'bun:test';
import { weakenedInFile } from '../../../../src/review/pipeline/detectors/weakened-tests';

/** Head lines the base lacks count as added; every head line counts as shown in the diff. */
function detect(base: string[], head: string[]) {
	const known = new Set(base.map((line) => line.trim()));
	const added = new Set<number>();
	const visible = new Set<number>();

	head.forEach((line, index) => {
		visible.add(index + 1);
		if (!known.has(line.trim())) added.add(index + 1);
	});

	return weakenedInFile({ path: 'src/fetcher.test.ts', base: base.join('\n'), head: head.join('\n'), added, visible });
}

function summarize(results: ReturnType<typeof detect>) {
	return results.map(({ title, line }) => ({ title, line }));
}

describe('weakenedInFile', () => {
	test('suspects an edited test whose new assertion only counts where the title picks one', () => {
		const results = detect(
			["test('keeps the most severe', () => {", '	expect(names).toEqual([high]);', '});'],
			["test('keeps the most severe', () => {", '	expect(names).toHaveLength(1);', '});']
		);

		expect(results.map(({ suspected, line }) => ({ suspected, line }))).toEqual([{ suspected: true, line: 2 }]);
	});

	test('flags an exact count turned into a lower bound on the same count', () => {
		const results = detect(
			["test('stops after the budget', async () => {", '	t.is(requestCount, 4);', '});'],
			["test('stops after the budget', async () => {", '	t.true(requestCount >= 4);', '});']
		);

		expect(summarize(results)).toEqual([
			{ title: '`stops after the budget` no longer checks the exact value', line: 2 }
		]);
	});

	test('flags toThrow with an error class that became a bare toThrow', () => {
		const results = detect(
			["test('rejects a bad url', () => {", '\texpect(() => parse(url)).toThrow(UrlError);', '});'],
			["test('rejects a bad url', () => {", '\texpect(() => parse(url)).toThrow();', '});']
		);

		expect(summarize(results)).toEqual([
			{ title: '`rejects a bad url` no longer checks which error is thrown', line: 2 }
		]);

		expect(results[0].evidence).toContain('toThrow(UrlError)');
		expect(results[0].evidence).toContain('toThrow()');
		expect(results[0].category).toBe('tests');
	});

	test('flags rejects.toThrow with a specific class replaced by a broad parent class', () => {
		const results = detect(
			["it('times out', async () => {", '\tawait expect(fetchSlow()).rejects.toThrow(RequestTimeoutException);', '});'],
			["it('times out', async () => {", '\tawait expect(fetchSlow()).rejects.toThrow(HTTPException);', '});']
		);

		expect(summarize(results)).toEqual([{ title: '`times out` now accepts a broader error', line: 2 }]);
	});

	test('does not flag a class swap when the old class is still asserted in the test', () => {
		const results = detect(
			["it('fails', () => {", '\texpect(() => run()).toThrow(TimeoutError);', '});'],
			[
				"it('fails', () => {",
				'\texpect(() => run()).toThrow(Error);',
				'\texpect(last).toBeInstanceOf(TimeoutError);',
				'});'
			]
		);

		expect(results).toEqual([]);
	});

	test('flags toBeInstanceOf with a specific class replaced by a broad one', () => {
		const results = detect(
			["it('aborts', async () => {", '\texpect(caught).toBeInstanceOf(AbortError);', '});'],
			["it('aborts', async () => {", '\texpect(caught).toBeInstanceOf(Error);', '});']
		);

		expect(summarize(results)).toEqual([{ title: '`aborts` now accepts a broader error', line: 2 }]);
	});

	test('flags an asserted instanceof whose class became a broad one', () => {
		const results = detect(
			["test('aborts', (t) => {", '\tt.true(caught instanceof AbortError);', '});'],
			["test('aborts', (t) => {", '\tt.true(caught instanceof Error);', '});']
		);

		expect(summarize(results)).toEqual([{ title: '`aborts` now accepts a broader error', line: 2 }]);
	});

	test('flags an AVA throws expectation that lost its instanceOf', () => {
		const results = detect(
			["test('rejects', (t) => {", '\tt.throws(() => run(), { instanceOf: ParseError });', '});'],
			["test('rejects', (t) => {", '\tt.throws(() => run());', '});']
		);

		expect(summarize(results)).toEqual([{ title: '`rejects` no longer checks which error is thrown', line: 2 }]);
	});

	test('flags an exact value check replaced by a range check on the same value', () => {
		const results = detect(
			["test('cuts off at the limit', () => {", '\texpect(cutoff).toBe(100);', '});'],
			["test('cuts off at the limit', () => {", '\texpect(cutoff).toBeGreaterThanOrEqual(100);', '});']
		);

		expect(summarize(results)).toEqual([
			{ title: '`cuts off at the limit` no longer checks the exact value', line: 2 }
		]);

		expect(results[0].evidence).toContain('expect(cutoff).toBe(100)');
	});

	test('flags assert.strictEqual replaced by assert.ok on the same subject', () => {
		const results = detect(
			["test('reads the flag', () => {", '\tassert.strictEqual(flag, "on");', '});'],
			["test('reads the flag', () => {", '\tassert.ok(flag);', '});']
		);

		expect(results).toHaveLength(1);
	});

	test('flags every swapped for some inside an assertion', () => {
		const results = detect(
			["test('all items are ready', () => {", '\texpect(items.every((item) => item.ready)).toBe(true);', '});'],
			["test('all items are ready', () => {", '\texpect(items.some((item) => item.ready)).toBe(true);', '});']
		);

		expect(summarize(results)).toEqual([
			{ title: '`all items are ready` now passes when only some items match', line: 2 }
		]);
	});

	test('flags a removed error type check while the test remains', () => {
		const results = detect(
			[
				"test('abort stops the call', async () => {",
				'\tconst error = await call(signal).catch((caught) => caught);',
				"\texpect(error.name).toBe('AbortError');",
				'\texpect(calls).toBe(1);',
				'});'
			],
			[
				"test('abort stops the call', async () => {",
				'\tconst error = await call(signal).catch((caught) => caught);',
				'\texpect(calls).toBe(1);',
				'});'
			]
		);

		expect(summarize(results)).toEqual([{ title: '`abort stops the call` no longer checks the error type', line: 1 }]);
	});

	test('flags a test whose assertion count dropped', () => {
		const results = detect(
			[
				"test('retries twice', async () => {",
				'\tconst value = await withRetry(flaky);',
				'\texpect(value).toBe(3);',
				'\texpect(attempts).toBe(3);',
				'});'
			],
			[
				"test('retries twice', async () => {",
				'\tconst value = await withRetry(flaky);',
				'\texpect(value).toBe(3);',
				'});'
			]
		);

		expect(summarize(results)).toEqual([{ title: '`retries twice` has fewer assertions', line: 1 }]);
		expect(results[0].evidence).toContain('2 assertions');
		expect(results[0].suspected).toBe(true);
	});

	test('matches a test nested in describe by its full title', () => {
		const base = ["describe('limiter', () => {", "\ttest('caps', () => {", '\t\texpect(n).toBe(5);', '\t});', '});'];

		const head = [
			"describe('limiter', () => {",
			"\ttest('caps', () => {",
			'\t\texpect(n).toBeTruthy();',
			'\t});',
			'});'
		];

		expect(summarize(detect(base, head))).toEqual([{ title: '`caps` no longer checks the exact value', line: 3 }]);
	});

	test('ignores a test that was added', () => {
		const results = detect(
			["test('old', () => {", '\texpect(a).toBe(1);', '});'],
			["test('old', () => {", '\texpect(a).toBe(1);', '});', "test('new', () => {", '\texpect(b).toBeTruthy();', '});']
		);

		expect(results).toEqual([]);
	});

	test('ignores a test that was deleted', () => {
		const results = detect(
			["test('one', () => {", '\texpect(a).toBe(1);', '});', "test('two', () => {", '\texpect(b).toBe(2);', '});'],
			["test('one', () => {", '\texpect(a).toBe(1);', '});']
		);

		expect(results).toEqual([]);
	});

	test('ignores a test that was renamed', () => {
		const results = detect(
			["test('caps the rate', () => {", '\texpect(rate).toBe(5);', '});'],
			["test('limits the rate', () => {", '\texpect(rate).toBeTruthy();', '});']
		);

		expect(results).toEqual([]);
	});

	test('ignores an assertion that only got stricter or was reworded at the same strength', () => {
		const results = detect(
			[
				"test('stricter', () => {",
				'\texpect(list).toBeDefined();',
				'\texpect(() => run()).toThrow();',
				'\texpect(total).toEqual(4);',
				'});'
			],
			[
				"test('stricter', () => {",
				'\texpect(list).toEqual([1, 2]);',
				'\texpect(() => run()).toThrow(RangeError);',
				'\texpect(total).toStrictEqual(4);',
				'});'
			]
		);

		expect(results).toEqual([]);
	});

	test('ignores a test whose body did not change', () => {
		const lines = ["test('same', () => {", '\texpect(a).toBe(1);', '});'];

		expect(detect(lines, lines)).toEqual([]);
	});

	test('ignores a commented-out assertion that goes away', () => {
		const results = detect(
			["test('notes', () => {", '\t// expect(old).toBe(1);', '\texpect(a).toBe(1);', '});'],
			["test('notes', () => {", '\texpect(a).toBe(1);', '});']
		);

		expect(results).toEqual([]);
	});
});
