import { expect, test } from 'bun:test';
import { reviewVariant } from '../src/env';
import { restoreEnvAfterEach } from './helpers/env';

restoreEnvAfterEach(['RECODER_REVIEW_VARIANT']);

test('an unset or empty review variant runs the baseline', () => {
	delete process.env.RECODER_REVIEW_VARIANT;

	const unset = reviewVariant();

	process.env.RECODER_REVIEW_VARIANT = '';

	expect(unset).toBeNull();
	expect(reviewVariant()).toBeNull();
});

test('a review variant that names no variant throws with the value instead of running the baseline', () => {
	process.env.RECODER_REVIEW_VARIANT = 'specialist';

	expect(() => reviewVariant()).toThrow('RECODER_REVIEW_VARIANT is "specialist"');
});
