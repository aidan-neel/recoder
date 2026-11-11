import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { isNewerRelease, parseReleaseTag } from '../../../src/cli/upgrade/release-tag';

test('a release is named with or without its v', () => {
	expect(parseReleaseTag('0.2.0')).toBe(parseReleaseTag('v0.2.0'));
});

test.each(['../v0.2.0', 'v0.2', 'v0.2.0/..', 'latest', 'v1.2.3?x=1', ''])(
	'%s is not a release and is refused before it reaches a download address',
	(text) => {
		expect(() => parseReleaseTag(text)).toThrow(expect.objectContaining({ exitCode: EXIT.usage }));
	}
);

test.each([
	['v0.2.1', '0.2.0', true],
	['v0.10.0', '0.9.9', true],
	['v1.0.0', '0.99.99', true],
	['v0.2.0', '0.2.0', false],
	['v0.1.0', '0.2.0', false],
	['v0.2.0', '0.2.0-beta.1', true],
	['v0.2.0-beta.1', '0.2.0', false]
])('release %s is newer than a running %s: %p', (tag, running, expected) => {
	expect(isNewerRelease(parseReleaseTag(tag), running)).toBe(expected);
});
