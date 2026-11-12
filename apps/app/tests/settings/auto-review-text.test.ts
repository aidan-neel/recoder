import { describe, expect, test } from 'bun:test';

import { intervalFrom } from '../../src/lib/settings/auto-review-text';

describe('an auto-review interval picked by hand', () => {
	test('only the offered intervals parse', () => {
		expect(intervalFrom('60')).toBe(60);
		expect(intervalFrom('1800')).toBe(1800);
		expect(intervalFrom('1')).toBeNull();
		expect(intervalFrom('abc')).toBeNull();
	});
});
