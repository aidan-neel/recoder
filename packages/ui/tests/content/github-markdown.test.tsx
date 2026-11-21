import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { GitHubMarkdown } from '../../src/components/content/github-markdown';
import { safeSrcSet } from '../../src/components/content/github-markdown-plugins';
import { MarkdownProse } from '../../src/components/content/markdown-render';

function renderGitHub(
	source: string,
	props?: { inlineCode?: ({ code }: { code: string }) => React.JSX.Element; forgeOrigin?: string | null }
) {
	return renderToStaticMarkup(
		<GitHubMarkdown inlineCode={props?.inlineCode} forgeOrigin={props?.forgeOrigin}>
			{source}
		</GitHubMarkdown>
	);
}

describe('GitHubMarkdown', () => {
	test('strips single-line, multi-line and inline HTML comments completely', () => {
		const source = [
			'<!-- coderabbit-ai-generated:v1 -->',
			'<!-- multi',
			'line comment -->',
			'Visible text.',
			'',
			'- [ ] <!-- {"checkboxId":"abc"} --> <strong>Autofix</strong>'
		].join('\n');

		const html = renderGitHub(source);

		expect(html).not.toContain('coderabbit-ai-generated');
		expect(html).not.toContain('line comment');
		expect(html).not.toContain('checkboxId');
		expect(html).not.toContain('&lt;!--');
		expect(html).toContain('<p>Visible text.</p>');
		expect(html).toContain('<strong>Autofix</strong>');
		expect(html).toContain('type="checkbox"');
	});

	test('renders <details> and <summary> through the kit Collapsible and honors open', () => {
		const closed = renderGitHub('<details><summary><strong>Walkthrough</strong></summary>\n\nHidden body.</details>');

		const open = renderGitHub(
			'<details open><summary><strong>Generate tests</strong></summary>\n\nShown body.</details>'
		);

		expect(closed).toContain('data-markdown-details=""');
		expect(closed).toContain('data-markdown-summary=""');
		expect(closed).toContain('<strong>Walkthrough</strong>');
		expect(closed).toContain('data-state="closed"');
		expect(closed).not.toContain('Hidden body.');

		expect(open).toContain('data-state="open"');
		expect(open).toContain('<strong>Generate tests</strong>');
		expect(open).toContain('Shown body.');
	});

	test('lifts a heading wrapping block HTML to avoid invalid heading nesting', () => {
		const source =
			'<h6>\n<details>\n<summary><strong>Recent review info</strong></summary>\n\nBody.\n</details>\n</h6>';

		const html = renderGitHub(source);

		expect(html).not.toContain('<h6');
		expect(html).toContain('data-heading-level="6"');
		expect(html).toContain('<strong>Recent review info</strong>');
	});

	test('renders <br> inside GFM table cells and markdown images as real <img> tags', () => {
		const source = [
			'| Layer | Status |',
			'| :--- | :---: |',
			'| **Peer range** <br> `package.json` | ![Passed](https://example.com/passed.svg) |'
		].join('\n');

		const html = renderGitHub(source);

		expect(html).toContain('<strong>Peer range</strong> <br/>');
		expect(html).not.toContain('&lt;br');
		expect(html).toContain('<img src="https://example.com/passed.svg" alt="Passed"');
		expect(html).toContain('referrerPolicy="no-referrer"');
	});

	test('renders theme-aware <picture> sources for dark and light modes and preserves explicit height', () => {
		const dual = renderGitHub(
			'<a href="https://example.com/stack"><picture>' +
				'<source media="(prefers-color-scheme: dark)" srcset="https://example.com/btn-dark.svg">' +
				'<source media="(prefers-color-scheme: light)" srcset="https://example.com/btn-light.svg">' +
				'<img src="https://example.com/btn-light.svg" alt="Explain Change" height="32">' +
				'</picture></a>'
		);

		const darkOnly = renderGitHub(
			'<picture>' +
				'<source media="(prefers-color-scheme: dark)" srcset="https://example.com/cog-dark.svg">' +
				'<img src="https://example.com/cog.svg" width="16" height="16" align="absmiddle" alt="">' +
				'</picture>'
		);

		expect(dual).toContain('data-ui="markdown-picture"');
		expect(dual).toContain('src="https://example.com/btn-dark.svg"');
		expect(dual).toContain('data-theme-only="dark"');
		expect(dual).toContain('src="https://example.com/btn-light.svg"');
		expect(dual).toContain('data-theme-only="light"');
		expect(dual).toContain('height:32px');

		expect(darkOnly).toContain('src="https://example.com/cog-dark.svg"');
		expect(darkOnly).toContain('src="https://example.com/cog.svg"');
		expect(darkOnly).toContain('data-align="absmiddle"');
		expect(darkOnly).toContain('aspect-ratio:16 / 16');
	});

	test('strips scripts, styles, iframes, handlers, inline styles, focus hijacks and unsafe URLs', () => {
		const hostile = [
			'<script>alert(1)</script>',
			'<style>body { display: none; }</style>',
			'<iframe src="https://evil.example"></iframe>',
			'<svg onload="alert(1)"><circle/></svg>',
			'<a href="javascript:alert(1)" onclick="alert(2)" tabindex="1" accesskey="x">click</a>',
			'<img src="javascript:alert(1)" onerror="alert(2)" style="position:fixed" alt="bad">',
			'<img src="data:image/svg+xml,<svg/>" alt="data-img">',
			'<picture><source media="(prefers-color-scheme: dark)" srcset="javascript:alert(1)"><img src="https://example.com/ok.svg" alt="ok"></picture>'
		].join('\n\n');

		const html = renderGitHub(hostile);

		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert(1)');
		expect(html).not.toContain('display: none');
		expect(html).not.toContain('<iframe');
		expect(html).not.toContain('<svg');
		expect(html).not.toContain('onclick');
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('data:image');
		expect(html).not.toContain('position:fixed');
		expect(html).not.toContain('tabIndex');
		expect(html).not.toContain('accessKey');
		expect(html).toContain('src="https://example.com/ok.svg"');
	});

	test('renders GitHub alert blockquotes with their semantic kind and leaves inline markers alone', () => {
		const alert = renderGitHub('> [!WARNING]\n> Dropping the column rewrites the table.');
		const plain = renderGitHub('> [!WARNING] inline text stays a plain quote.');

		expect(alert).toContain('data-alert="warning"');
		expect(alert).toContain('data-ui="markdown-alert-title"');
		expect(alert).toContain('Warning');
		expect(alert).toContain('Dropping the column rewrites the table.');
		expect(alert).not.toContain('[!WARNING]');

		expect(plain).not.toContain('data-alert=');
		expect(plain).toContain('[!WARNING] inline text stays a plain quote.');
	});

	test('routes both backtick and HTML <code> spans through inlineCode', () => {
		const Badge = ({ code }: { code: string }) => <kbd>{code}</kbd>;
		const html = renderGitHub('Check `lease.ts` and up to <code>0e5fcde</code>.', { inlineCode: Badge });

		expect(html).toContain('<kbd>lease.ts</kbd>');
		expect(html).toContain('<kbd>0e5fcde</kbd>');
	});

	test('links @mentions to the forge while leaving emails, scoped packages, code and summaries alone', () => {
		const source = [
			'@isaiah-harville is attempting to deploy, cc (@aidan-neel, @a).',
			'Email user@example.com, install @sivir-ui/svelte, check @example.com, or run `@isaiah-harville`.',
			'Already linked: [@isaiah-harville](https://vercel.com).',
			'<details><summary>By @isaiah-harville</summary>\n\nPing @isaiah-harville.</details>'
		].join('\n\n');

		const html = renderGitHub(source);

		expect(html).toContain(
			'<a href="https://github.com/isaiah-harville" data-mention="" target="_blank" rel="noopener noreferrer">@isaiah-harville</a> is attempting'
		);

		expect(html).toContain(
			'(<a href="https://github.com/aidan-neel" data-mention="" target="_blank" rel="noopener noreferrer">@aidan-neel</a>, <a href="https://github.com/a" data-mention="" target="_blank" rel="noopener noreferrer">@a</a>).'
		);

		expect(html).not.toContain('github.com/example');
		expect(html).not.toContain('github.com/sivir-ui');
		expect(html).toContain('<code class="inline-code">@isaiah-harville</code>');
		expect(html).toContain('href="https://vercel.com"');
		expect(html).toContain('<span data-ui="markdown-summary-label">By @isaiah-harville</span>');
	});

	test('uses a custom forgeOrigin for @mentions and disables mention links when forgeOrigin is null', () => {
		const gitlab = renderGitHub('Ping @isaiah-harville.', { forgeOrigin: 'https://git.company.com/org/repo' });
		const local = renderGitHub('Ping @isaiah-harville.', { forgeOrigin: null });

		expect(gitlab).toContain('href="https://git.company.com/isaiah-harville" data-mention=""');
		expect(local).not.toContain('<a ');
		expect(local).toContain('Ping @isaiah-harville.');
	});

	test('leaves default MarkdownProse strict with raw HTML escaped and images as links', () => {
		const html = renderToStaticMarkup(
			<MarkdownProse>{'<b>raw</b> and ![pic](https://example.com/a.png)'}</MarkdownProse>
		);

		expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
		expect(html).not.toContain('<img');
		expect(html).toContain('<a href="https://example.com/a.png"');
	});
});

describe('safeSrcSet', () => {
	test('keeps http(s) URLs with commas in query parameters and rejects unsafe protocols', () => {
		expect(
			safeSrcSet('https://cdn.example.com/img?fit=crop,w=200 1x, https://cdn.example.com/img?fit=crop,w=400 2x')
		).toEqual({
			src: 'https://cdn.example.com/img?fit=crop,w=200',
			srcSet: 'https://cdn.example.com/img?fit=crop,w=200 1x, https://cdn.example.com/img?fit=crop,w=400 2x'
		});

		expect(safeSrcSet('javascript:alert(1)')).toBeNull();
		expect(safeSrcSet('data:image/png;base64,AAA')).toBeNull();
		expect(safeSrcSet('https://example.com/a.png bogus')).toBeNull();
	});
});
