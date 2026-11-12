import { describe, expect, test } from 'bun:test';

import { findLinks } from '../../src/components/form/link-find';

/** The URLs `findLinks` finds in a text, as strings. */
function urlsIn(text: string): string[] {
	return findLinks(text).map((range) => text.slice(range.start, range.end));
}

describe('findLinks', () => {
	test('leaves trailing punctuation out of a link', () => {
		expect(urlsIn('see https://acme.dev/x. Then https://acme.dev/y, and https://acme.dev/z!')).toEqual([
			'https://acme.dev/x',
			'https://acme.dev/y',
			'https://acme.dev/z'
		]);
	});

	test('keeps balanced parentheses in and drops a closing one the link did not open', () => {
		expect(urlsIn('(https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
		expect(urlsIn('ends https://acme.dev/x)')).toEqual(['https://acme.dev/x']);
	});

	test('drops a very long run of unopened closing brackets without scanning the link again for each one', () => {
		const link = 'https://acme.dev/x';

		expect(urlsIn(`${link}${')'.repeat(200_000)}`)).toEqual([link]);
	}, 2000);

	test('keeps the closing brackets the link opened when more follow', () => {
		expect(urlsIn('(see https://acme.dev/a_(b)_[c]))].')).toEqual(['https://acme.dev/a_(b)_[c]']);
	});

	test('finds links at the very start and the very end of the text', () => {
		expect(urlsIn('https://acme.dev/a then https://acme.dev/b')).toEqual(['https://acme.dev/a', 'https://acme.dev/b']);
	});

	test('finds the URL of a Markdown link and leaves the brackets as text', () => {
		const text = '[docs](https://acme.dev/docs)';

		expect(findLinks(text)).toEqual([{ start: 7, end: 28 }]);
	});

	test('ignores every scheme but http and https', () => {
		expect(urlsIn('javascript:alert(1) data:text/html,hi file:///etc/hosts ftp://acme.dev mailto:a@acme.dev')).toEqual(
			[]
		);
	});

	test('needs the scheme to start a word', () => {
		expect(urlsIn('xhttps://acme.dev')).toEqual([]);
	});

	test('keeps the query and the fragment', () => {
		expect(urlsIn('https://acme.dev/a?q=1&r=2#frag')).toEqual(['https://acme.dev/a?q=1&r=2#frag']);
	});

	test('stops at a line break and at a closing quote', () => {
		expect(urlsIn('https://acme.dev/a\nnext “https://acme.dev/q”')).toEqual([
			'https://acme.dev/a',
			'https://acme.dev/q'
		]);
	});

	test('skips a scheme with no host', () => {
		expect(urlsIn('https:// and http://')).toEqual([]);
	});

	test('finds a very long URL whole', () => {
		const long = `https://acme.dev/${'a'.repeat(5000)}`;

		expect(urlsIn(`x ${long} y`)).toEqual([long]);
	});
});
