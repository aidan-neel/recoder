import { expect, test } from 'bun:test';
import type { ChangeModel } from '../../../../src/review/pipeline/change-model/types';
import { CASES } from './cases';
import { buildFrom } from './fixtures';

/**
 * The model without the record-only cuts (`omittedCallers`,
 * `omittedReferences`, `omittedTests`): no prompt reads them, and main does
 * not set them.
 */
function withoutRecords(model: ChangeModel): ChangeModel {
	return {
		...model,
		symbols: model.symbols.map(
			({ omittedCallers: _callers, omittedReferences: _references, omittedTests: _tests, ...symbol }) => symbol
		)
	};
}

/**
 * The change model of every fixture, as main built it before caller selection
 * existed. With the flag off, measurement must not move a caller, a reference
 * or a field a prompt reads, so any difference here is a behavior change.
 */
for (const [name, { base, head }] of Object.entries(CASES)) {
	test(`the ${name} change model is unchanged with caller selection off`, async () => {
		const { model } = await buildFrom(base, head, false);

		expect(withoutRecords(model)).toMatchSnapshot();
	});
}
