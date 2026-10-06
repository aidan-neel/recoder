import { expect, test } from 'bun:test';
import { CASES } from './cases';
import { buildFrom } from './fixtures';

/**
 * The change model of every fixture, as main built it before caller selection
 * existed. With the flag off, measurement must not move a caller, a reference
 * or a field, so any difference here is a behavior change.
 */
for (const [name, { base, head }] of Object.entries(CASES)) {
	test(`the ${name} change model is unchanged with caller selection off`, async () => {
		const { model } = await buildFrom(base, head, false);

		expect(model).toMatchSnapshot();
	});
}
