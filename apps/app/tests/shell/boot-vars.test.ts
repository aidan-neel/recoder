import { describe, expect, test } from 'bun:test';

import { storedStyleScript, wholeIn } from '../../src/lib/shell/boot-vars';

/** A script that copies a stored `{ n }` from 1 to 9 onto `--n`. */
const SCRIPT = storedStyleScript('k', `v&&${wholeIn('v.n', 1, 9)}`, "s.setProperty('--n',String(v.n));");

/** Runs the script against `getItem`, as the server's HTML would before first paint, and returns the variables it set. */
function run(getItem: () => string | null): Record<string, string> {
	const vars: Record<string, string> = {};
	const style = { setProperty: (name: string, value: string) => void (vars[name] = value) };

	new Function('localStorage', 'document', SCRIPT)({ getItem }, { documentElement: { style } });

	return vars;
}

describe('boot scripts that copy stored values onto <html>', () => {
	test('a value that passes the check is applied', () => {
		expect(run(() => '{"n":3}')).toEqual({ '--n': '3' });
	});

	test('malformed, out-of-range or missing values set nothing and throw nothing', () => {
		for (const stored of [
			null,
			'not json',
			'null',
			'[]',
			'"3"',
			'{"n":"3"}',
			'{"n":1.5}',
			'{"n":0}',
			'{"n":10}',
			'{"n":1e400}'
		]) {
			expect(run(() => stored)).toEqual({});
		}
	});

	test('storage that throws on read sets nothing and throws nothing', () => {
		expect(
			run(() => {
				throw new Error('blocked');
			})
		).toEqual({});
	});
});
