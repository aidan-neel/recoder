import { expect, test } from 'bun:test';
import { oauthClientId, reviewVariant } from '../src/env';
import { restoreEnvAfterEach } from './helpers/env';

restoreEnvAfterEach(['RECODER_REVIEW_VARIANT', 'RECODER_GITHUB_CLIENT_ID']);

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

test('a blank OAuth client id means the forge is not set up, and a malformed one throws', () => {
	process.env.RECODER_GITHUB_CLIENT_ID = '  ';
	expect(oauthClientId('github')).toBeUndefined();

	process.env.RECODER_GITHUB_CLIENT_ID = ' Iv1.abc123 ';
	expect(oauthClientId('github')).toBe('Iv1.abc123');

	process.env.RECODER_GITHUB_CLIENT_ID = 'bad id; drop';
	expect(() => oauthClientId('github')).toThrow('RECODER_GITHUB_CLIENT_ID is not a valid OAuth client id');
});
