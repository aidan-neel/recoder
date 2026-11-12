import { describe, expect, test } from 'bun:test';
import { aimedMutants } from '../../../../src/review/pipeline/mutation/aim';
import type { DetectorResult, SuspicionShape } from '../../../../src/review/pipeline/detectors/types';

const suspicion = (shape?: SuspicionShape): DetectorResult => ({
	detector: 'weak-new-tests',
	category: 'tests',
	title: '`it aborts` accepts any `HTTPException`',
	body: 'This change adds `TimeoutException`, a subclass of `HTTPException`, but the test accepts any `HTTPException`.',
	file: 'src/a.test.ts',
	line: 3,
	evidence: '',
	...(shape ? { shape } : {}),
	suspected: true
});

const test_ = [
	"it('it aborts', async () => {",
	'\tconst err = new TimeoutException(50);',
	'\tawait run(err);',
	'\texpect(reason).toThrow(HTTPException);',
	'});'
].join('\n');

const thrown = [
	'export class TimeoutException extends HTTPException {}',
	'export function run() {',
	'\tconst reason = new TimeoutException(50);',
	'\treturn abort(reason);',
	'}'
].join('\n');

describe('aimedMutants', () => {
	test('swaps a made subclass for the broad class a broadError suspicion names', async () => {
		const mutants = await aimedMutants(suspicion('broadError'), test_, [{ path: 'src/a.ts', head: thrown }]);

		expect(mutants.map(({ line }) => line)).toEqual([3]);
		expect(mutants[0]?.text).toContain('new HTTPException(50)');
	});

	test('aims the edit the suspicion shape names instead of the generic ones', async () => {
		const weak = ["it('needs enough retries', () => {", '\texpect(f(4)).toBe(true);', '});'].join('\n');

		const head = ['export function f(n: number) {', '\treturn n > 3;', '}'].join('\n');

		const mutants = await aimedMutants(suspicion('lowerBound'), weak, [{ path: 'src/a.ts', head }]);

		expect(mutants.map(({ line }) => line)).toEqual([2]);
		expect(mutants[0]?.text).toContain('return n > 4;');
	});

	test('falls back to the generic edits when the suspicion carries no shape', async () => {
		const weak = ["it('needs enough retries', () => {", '\texpect(f(4)).toBe(true);', '});'].join('\n');

		const head = ['export function f(n: number) {', '\treturn n > 3;', '}'].join('\n');

		const mutants = await aimedMutants(suspicion(), weak, [{ path: 'src/a.ts', head }]);

		expect(mutants.map(({ line }) => line)).toEqual([2]);
		expect(mutants[0]?.text).toContain('return n >= 3;');
	});
});
