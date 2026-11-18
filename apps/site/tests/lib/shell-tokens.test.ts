import { expect, test } from 'bun:test';

import { shellHtml } from '~/lib/shell-tokens';

/** The text a browser shows for the HTML: tags dropped, entities read. */
function shownText(html: string): string {
	return html
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

test('flags, a placeholder, a value and a comment each get their span', () => {
	expect(shellHtml('recoder wait -p <run-id> --timeout 5   # waits')).toBe(
		'recoder wait <span data-token="flag">-p</span> <span data-token="placeholder">&lt;run-id&gt;</span> ' +
			'<span data-token="flag">--timeout</span> <span data-token="value">5</span>   ' +
			'<span data-token="comment"># waits</span>'
	);
});

test('a pipe and a bare -- are operators, and a URL is a value', () => {
	expect(shellHtml('curl -fsSL https://recoder.dev/install.sh | sh')).toBe(
		'curl <span data-token="flag">-fsSL</span> <span data-token="value">https://recoder.dev/install.sh</span> ' +
			'<span data-token="operator">|</span> sh'
	);

	expect(shellHtml('claude mcp add recoder -- recoder mcp')).toContain('<span data-token="operator">--</span>');
});

test('a placeholder with a space and a choice of words are placeholders', () => {
	expect(shellHtml('--reviewer <model id>')).toBe(
		'<span data-token="flag">--reviewer</span> <span data-token="placeholder">&lt;model id&gt;</span>'
	);

	expect(shellHtml('--budget low|medium|high')).toContain('<span data-token="placeholder">low|medium|high</span>');
	expect(shellHtml('recoder status [run]')).toContain('<span data-token="placeholder">[run]</span>');
});

test('a flag after a flag is a flag, and a word after a short flag is plain', () => {
	expect(shellHtml('recoder review -p --detach')).toBe(
		'recoder review <span data-token="flag">-p</span> <span data-token="flag">--detach</span>'
	);

	expect(shellHtml('tar -x file')).toBe('tar <span data-token="flag">-x</span> file');
});

test('a value attached with = splits from its flag', () => {
	expect(shellHtml('--format=json')).toBe(
		'<span data-token="flag">--format</span>=<span data-token="value">json</span>'
	);
});

test('markup characters in the source are escaped, and no text is lost', () => {
	const sources = [
		'echo "<b>&</b>" > out.txt && cat <in',
		`say 'it"s' "un closed`,
		'a # one\nb --x  y\n\n  # only a comment',
		'path/<run-id>/x a&b'
	];

	for (const source of sources) {
		const html = shellHtml(source);

		expect(shownText(html)).toBe(source);
		expect(html.replace(/<\/?span[^>]*>/g, '')).not.toMatch(/[<>]/);
	}
});

test('a # inside a word does not start a comment', () => {
	expect(shellHtml('open page#top')).toBe('open page#top');
});
