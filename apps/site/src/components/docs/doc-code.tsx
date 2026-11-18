import { CodeBlockView, FileIcon, StaticCodeBlock, type MarkdownCodeParts, type MarkdownFence } from '@recoder/ui';
import { TerminalWindowIcon } from '@phosphor-icons/react/dist/ssr';

import { shellHtml } from '~/lib/shell-tokens';

/** The fence names that hold shell commands. */
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

/** A file name on a fence's opening line: `title="config.json"`. */
const FILE_TITLE = /\btitle="([^"]+)"/;

/**
 * Shell commands. One command is a single line with a prompt; several get a
 * head row that says Terminal. The prompt is drawn beside the code and never
 * copied.
 */
function ShellBlock({ code }: { code: string }) {
	const title = code.includes('\n') ? (
		<>
			<TerminalWindowIcon aria-hidden weight="bold" />
			Terminal
		</>
	) : undefined;

	return <CodeBlockView source={code} html={shellHtml(code)} copy gutter="prompt" title={title} />;
}

/**
 * A docs page's fenced code. Shell fences go to `ShellBlock`. A fence that
 * names a file (`title="…"`) shows the name in a head row and numbers its
 * lines. Any other fence is the kit's plain block.
 */
function DocFence({ code, lang, meta }: MarkdownFence) {
	if (lang && SHELL_LANGS.has(lang)) return <ShellBlock code={code} />;

	const file = FILE_TITLE.exec(meta)?.[1];

	if (!file) return <StaticCodeBlock source={code} lang={lang} copy />;

	const title = (
		<>
			<FileIcon path={file} />
			<span className="font-mono">{file}</span>
		</>
	);

	return <StaticCodeBlock source={code} lang={lang} copy gutter="numbers" title={title} />;
}

/**
 * Inline code with its flags and placeholders in spans, which the docs
 * styles color in a table's first column and leave plain in running text.
 * `shellHtml` returns only the code's own text, escaped, inside those spans.
 */
function DocInlineCode({ code }: { code: string }) {
	return <code className="inline-code" dangerouslySetInnerHTML={{ __html: shellHtml(code) }} />;
}

/** How the docs draw the code in their Markdown. One object, kept: the kit caches rendered text by it. */
export const DOC_CODE: MarkdownCodeParts = { fence: DocFence, inline: DocInlineCode };
