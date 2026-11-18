import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CodeBlockView } from '../../src/components/content/code-block-view';
import type { MarkdownCodeParts, MarkdownFence } from '../../src/components/content/markdown-parts';
import { StaticMarkdown } from '../../src/components/content/markdown-render';

/** A fence part that keeps what it was given, so a test can read it. */
function recordingParts(): { parts: MarkdownCodeParts; fences: MarkdownFence[] } {
	const fences: MarkdownFence[] = [];

	const fence = (given: MarkdownFence) => {
		fences.push(given);

		return null;
	};

	return { parts: { fence }, fences };
}

test('a page fence gets the code without its final newline, the language and the rest of the opening line', () => {
	const { parts, fences } = recordingParts();

	renderToStaticMarkup(<StaticMarkdown code={parts}>{'```json title=".mcp.json"\n{ "a": 1 }\n```'}</StaticMarkdown>);

	expect(fences).toEqual([{ code: '{ "a": 1 }', lang: 'json', meta: 'title=".mcp.json"' }]);
});

test('a fence with no language and no info gives a null language and an empty meta', () => {
	const { parts, fences } = recordingParts();

	renderToStaticMarkup(<StaticMarkdown code={parts}>{'```\nplain\n```'}</StaticMarkdown>);

	expect(fences).toEqual([{ code: 'plain', lang: null, meta: '' }]);
});

test('a page inline part draws code spans in plain paragraphs and in parsed tables alike', () => {
	const parts: MarkdownCodeParts = { inline: ({ code }) => <kbd>{code}</kbd> };
	const plain = renderToStaticMarkup(<StaticMarkdown code={parts}>{'Run `recoder doctor` now.'}</StaticMarkdown>);

	const table = renderToStaticMarkup(
		<StaticMarkdown code={parts}>{'| Flag | Use |\n| --- | --- |\n| `--budget low\\|high` | x |'}</StaticMarkdown>
	);

	expect(plain).toContain('<kbd>recoder doctor</kbd>');
	expect(table).toContain('<kbd>--budget low|high</kbd>');
});

test('a prompt gutter marks the lines that hold a command and leaves blank lines empty', () => {
	const markup = renderToStaticMarkup(<CodeBlockView source={'one\n\n  \ntwo'} html="" gutter="prompt" />);

	expect(markup).toContain('>$\n\n\n$</span>');
});
