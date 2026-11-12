import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cachedMarkdown } from '../../src/components/content/markdown-cache';
import { MarkdownProse, prepareMarkdown } from '../../src/components/content/markdown-render';
import { MARKDOWN_PARTS } from '../../src/components/content/markdown-parts';

/** The kit's markup inside its wrapper: the plain-text shortcut's tree, or the parser's. */
function viaKit(source: string): string {
	return renderToStaticMarkup(<MarkdownProse>{source}</MarkdownProse>)
		.replace(/^<div[^>]*>/, '')
		.replace(/<\/div>$/, '');
}

/** What react-markdown with GFM renders for the same source and parts. */
function viaParser(source: string): string {
	return renderToStaticMarkup(
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_PARTS}>
			{source}
		</ReactMarkdown>
	);
}

/**
 * Plain model text and code spans that take the shortcut, and text one
 * character away from becoming syntax: emphasis, longer or unpaired code
 * runs, links, autolinks, entities, escapes, tables, strikethrough,
 * headings, quotes, lists, breaks and odd whitespace.
 */
const SOURCES = [
	'Review complete. 3 confirmed findings.',
	'One.\n\nTwo paragraphs here.',
	'First.\n\nSecond.\n\nThird, with "quotes" and (parens)!',
	'PR #160 fixes it. Costs 3.5 min; ok?',
	'Ünïcødé — dashes – and “quotes” … ok',
	'=== not a heading',
	'Ends with a dash -',
	'2024 was long',
	'  leading',
	'trailing  ',
	'trailing\u00a0',
	'line\nbreak',
	'crlf\r\nbreak',
	'tab\tinside',
	'nul\0char',
	'1. list',
	'2) list',
	'- item',
	'+ item',
	'* item',
	'---',
	'# Heading',
	'> quote',
	'some *emphasis* here',
	'snake_case_name',
	'use `code`',
	'a `429` with `Retry-After` when it runs out',
	'`first` and last `x`',
	'`a`b`c`',
	'`a``b`',
	'``a `b` c``',
	'a ``double`` b',
	'```fence```',
	'`unclosed',
	'` spaced `',
	'`lead`  ',
	'`tab\tinside`',
	'`*a*` and `<b>` and `&amp;` and `a\\`',
	'`\u00a0edge`',
	'www.`x`',
	'1`.` item',
	'-`x`',
	'#`x`',
	'a.`b`.com',
	'a [link](https://example.com)',
	'see https://example.com',
	'see www.example.com',
	'mail a@b.co',
	'a ~~b~~ c',
	'a | b',
	'x &amp; y',
	'AT&T',
	'escaped \\* star',
	'<b>raw</b>',
	'footnote[^1]',
	'',
	'\n\n',
	'a\n\n\nb'
];

describe('MarkdownProse', () => {
	test.each(SOURCES)('renders %j as the parser does', (source) => {
		expect(viaKit(source)).toBe(viaParser(source));
	});

	test.each([
		['words, marks and blank lines', 'abc XYZ.,;:!?\'"()-+#=1234567890éü—\n\n  /%$^{}*_`[]<>&|~@'],
		['words and code spans', 'ab c.``` \t\u00a0*&<\\\n']
	])('renders generated text of %s as the parser does', (_, alphabet) => {
		let seed = 42;

		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;

			return seed / 2147483648;
		};

		for (let run = 0; run < 2000; run++) {
			const length = 1 + Math.floor(next() * 40);
			const source = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');

			expect([source, viaKit(source)]).toEqual([source, viaParser(source)]);
		}
	});
});

/** Runs idle callbacks at once while `run` runs, so a prepare happens before the test reads the cache. */
function withIdleNow(run: () => void): void {
	const idle = globalThis.requestIdleCallback;

	globalThis.requestIdleCallback = ((callback: IdleRequestCallback) => {
		callback({ didTimeout: false, timeRemaining: () => 50 });

		return 0;
	}) as typeof requestIdleCallback;

	try {
		run();
	} finally {
		globalThis.requestIdleCallback = idle;
	}
}

describe('prepareMarkdown', () => {
	test('keeps the tree where the client renderer reads it, so the first render does not parse again', () => {
		const source = 'Prepared **brief** with a list:\n\n- one [link](https://example.com)\n- `two`';

		withIdleNow(() => prepareMarkdown(source));

		expect(() =>
			cachedMarkdown(MARKDOWN_PARTS, source, () => {
				throw new Error('parsed again');
			})
		).not.toThrow();
	});
});
