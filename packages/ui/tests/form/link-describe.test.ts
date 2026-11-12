import { describe, expect, test } from 'bun:test';

import { describeLink, type LinkDescription } from '../../src/components/form/link-describe';

/** The parts of a description the embed shows. */
type Shown = Pick<LinkDescription, 'kind' | 'forge' | 'label' | 'number'>;

/** What the embed shows for a URL. */
function shown(url: string): Shown {
	const { kind, forge, label, number } = describeLink(url);

	return { kind, forge, label, number };
}

describe('describeLink', () => {
	test('labels a GitHub pull request with the repository and number, whatever page of it the link opens', () => {
		const expected: Shown = { kind: 'pull', forge: 'github', label: 'api #214', number: 214 };

		expect(shown('https://github.com/acme/api/pull/214')).toEqual(expected);
		expect(shown('https://github.com/acme/api/pull/214/files?w=1#diff-abc')).toEqual(expected);
	});

	test('labels a GitLab merge request with a bang, under nested groups', () => {
		expect(shown('https://gitlab.com/group/sub/proj/-/merge_requests/12')).toEqual({
			kind: 'pull',
			forge: 'gitlab',
			label: 'proj !12',
			number: 12
		});
	});

	test('reads self-hosted GitHub and GitLab hosts', () => {
		expect(shown('https://github.acme.dev/platform/api/pull/7')).toEqual({
			kind: 'pull',
			forge: 'github',
			label: 'api #7',
			number: 7
		});

		expect(shown('https://git.acme.dev/team/svc/-/merge_requests/44')).toEqual({
			kind: 'pull',
			forge: 'gitlab',
			label: 'svc !44',
			number: 44
		});
	});

	test('keeps the port a self-hosted forge is served on, so the address matches the repository there', () => {
		const link = describeLink('https://gitlab.acme.dev:8443/team/svc/-/merge_requests/44');

		expect(link.address).toBe('gitlab.acme.dev:8443/team/svc');
		expect(link.label).toBe('svc !44');
		expect(describeLink('http://localhost:3000/docs').label).toBe('localhost:3000/docs');
	});

	test('labels issues, commits, files and repositories', () => {
		expect(shown('https://github.com/acme/api/issues/9#issuecomment-5').label).toBe('api #9');
		expect(shown('https://github.com/acme/api/commit/0123456789abcdef0123').label).toBe('api@0123456');
		expect(shown('https://gitlab.com/group/sub/proj/-/commit/abcdef1234567').label).toBe('proj@abcdef1');
		expect(shown('https://github.com/acme/api/blob/main/src/server/retry.ts#L40').label).toBe('retry.ts:40');
		expect(shown('https://gitlab.com/group/sub/proj').label).toBe('group/sub/proj');
	});

	test('keeps the pull request number for a commit inside a pull request', () => {
		expect(shown('https://github.com/acme/api/pull/214/commits/0123456789abcdef')).toEqual({
			kind: 'commit',
			forge: 'github',
			label: 'api@0123456',
			number: 214
		});
	});

	test('labels any other link with its host and a shortened path', () => {
		expect(shown('https://docs.acme.dev/guide/limits/retries?tab=2#top')).toEqual({
			kind: 'link',
			forge: null,
			label: 'docs.acme.dev/guide/…/retries',
			number: null
		});

		expect(describeLink('https://acme.dev/').name).toBe('link to acme.dev');
	});

	test('caps a very long path segment in the label', () => {
		const { label } = describeLink(`https://acme.dev/${'a'.repeat(3000)}`);

		expect(label.length).toBeLessThan(60);
		expect(label.endsWith('…')).toBe(true);
	});
});
