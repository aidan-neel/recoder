import { describe, expect, test } from 'bun:test';
import { aimedMutants } from '../../../../src/review/pipeline/mutation/aim';

const suspicion = {
	detector: 'weak-new-tests' as const,
	category: 'tests' as const,
	title: '`it aborts` accepts any `HTTPException`',
	body: 'This change adds `TimeoutException`, a subclass of `HTTPException`, but the test accepts any `HTTPException`.',
	file: 'src/a.test.ts',
	line: 3,
	evidence: '',
	suspected: true
};

const test_ = [
	"it('it aborts', async () => {",
	'\tawait run();',
	'\texpect(reason).toBeInstanceOf(HTTPException);',
	'});'
].join('\n');

describe('aimedMutants', () => {
	test('swaps a made subclass for its base class even when the line does not throw', async () => {
		const head = [
			'export class TimeoutException extends HTTPException {}',
			'export function run() {',
			'\tconst reason = new TimeoutException(50);',
			'\treturn abort(reason);',
			'}'
		].join('\n');

		const mutants = await aimedMutants(suspicion, test_, [{ path: 'src/a.ts', head }]);

		expect(mutants.map(({ line }) => line)).toEqual([3]);
		expect(mutants[0]!.text).toContain('new HTTPException(50)');
	});
});
