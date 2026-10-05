import type { Assertion } from './test-source.js';

export const EXACT_MATCHERS = new Set([
	'toBe',
	'toEqual',
	'toStrictEqual',
	'is',
	'deepEqual',
	'equal',
	'strictEqual',
	'deepStrictEqual'
]);

export const LOOSE_MATCHERS = new Set([
	'toBeTruthy',
	'toBeDefined',
	'not.toBeUndefined',
	'toBeGreaterThan',
	'toBeGreaterThanOrEqual',
	'toBeLessThan',
	'toBeLessThanOrEqual',
	'toContain',
	'toMatch',
	'truthy',
	'ok'
]);

const THROW_MATCHERS = new Set(['toThrow', 'toThrowError']);

/** `t.throws`, `t.throwsAsync`, `assert.throws` and `assert.rejects`: the second argument says what to expect. */
const THROW_CALLS = new Set(['throws', 'throwsAsync', 'rejects']);

/** Error classes broad enough that catching one proves little about which failure happened. */
export const BROAD_ERRORS = new Set([
	'Error',
	'Exception',
	'BaseError',
	'BaseException',
	'AppError',
	'ApiError',
	'HttpError',
	'HTTPError',
	'HttpException',
	'HTTPException'
]);

/** The matcher with its `not`, as `not.toBe`. */
export function matcherKey(assertion: Assertion): string {
	return `${assertion.modifiers.includes('not') ? 'not.' : ''}${assertion.method}`;
}

/** The expected error a throw assertion names (`''` when it names none), or null when it isn't a throw assertion. */
export function expectedError(assertion: Assertion): string | null {
	if (assertion.family === 'expect') {
		return THROW_MATCHERS.has(assertion.method) && !assertion.modifiers.includes('not')
			? (assertion.args[1] ?? '')
			: null;
	}

	if (!THROW_CALLS.has(assertion.method)) return null;

	const second = assertion.args[1] ?? '';

	return /^(undefined|null|['"`])/.test(second) ? '' : second;
}

/** The error class an expectation names: `TimeoutError` or `{ instanceOf: TimeoutError }`. */
export function errorClass(expected: string): string | null {
	return /^[A-Z]\w*$/.exec(expected)?.[0] ?? /\b(?:instanceOf|is)\s*:\s*([A-Z]\w*)/.exec(expected)?.[1] ?? null;
}

/** Whether the assertion only passes when its first argument is true: `t.true(x)`, `assert(x)`, `expect(x).toBe(true)`. */
export function assertsTrue(assertion: Assertion): boolean {
	if (assertion.family === 'expect') {
		return EXACT_MATCHERS.has(assertion.method) && !assertion.modifiers.length && assertion.args[1] === 'true';
	}

	return assertion.family === 'ava'
		? assertion.method === 'true'
		: assertion.method === '' || assertion.method === 'ok';
}

/** What an instance check tests and the class it requires: `expect(x).toBeInstanceOf(Y)` or an asserted `x instanceof Y`. */
export function instanceCheck(assertion: Assertion): { subject: string; name: string } | null {
	if (assertion.family === 'expect' && assertion.method === 'toBeInstanceOf' && !assertion.modifiers.length) {
		const name = errorClass(assertion.args[1] ?? '');

		return name ? { subject: assertion.args[0] ?? '', name } : null;
	}

	const match = assertsTrue(assertion) ? /^(.+?)\s+instanceof\s+([A-Z]\w*)$/.exec(assertion.args[0] ?? '') : null;

	return match ? { subject: match[1]!, name: match[2]! } : null;
}
