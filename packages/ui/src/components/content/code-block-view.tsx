import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { CopyButton } from '../display/copy-button';

/** The code a block shows: the source without its final newline, so a fenced block ends on its last line. */
export function codeSource(code: string): string {
	return code.replace(/\n$/, '');
}

/** What the column left of the code holds: every line's number, or a shell prompt on each line that holds a command. */
type CodeGutter = 'numbers' | 'prompt';

/** How a block looks around its code. `CodeBlockView` and `StaticCodeBlock` share these. */
export interface CodeBlockLook {
	copy?: boolean;
	wrap?: boolean;
	/** A head row that names the code, such as "Terminal" or a file name. The copy button moves into it and always shows. */
	title?: ReactNode;
	/** A quiet column left of the code. It is never selected or copied. It needs lines that do not wrap. */
	gutter?: CodeGutter;
	className?: string;
}

interface CodeBlockViewProps extends CodeBlockLook {
	/** The code, through `codeSource`. */
	source: string;
	/** `source` as HTML: highlighted, or escaped plain text. Both take the same lines, so a swap never moves. */
	html: string;
}

const SHELL_PROMPT = '$';

/** The gutter's text, one line for each line of the code: its number, or a prompt where the line holds a command. */
function gutterText(source: string, gutter: CodeGutter): string {
	const lines = source.split('\n');

	if (gutter === 'numbers') return lines.map((_, index) => index + 1).join('\n');

	return lines.map((line) => (line.trim() ? SHELL_PROMPT : '')).join('\n');
}

/**
 * The code block's markup with its HTML already made. It holds no hooks, so
 * `CodeBlock` renders it on the client and `StaticMarkdown` in a server
 * component.
 */
export function CodeBlockView({
	source,
	html,
	copy = false,
	wrap = false,
	title,
	gutter,
	className
}: CodeBlockViewProps) {
	const titled = title !== undefined && title !== null;

	return (
		<div
			data-ui="code-block"
			data-layout={source.includes('\n') ? 'multi-line' : 'single-line'}
			data-wrap={wrap || undefined}
			data-copy={copy || undefined}
			data-gutter={gutter}
			className={cn(
				'relative min-w-0 overflow-hidden rounded-(--radius-row) bg-code font-mono text-[12.5px] leading-5 text-(--syn-plain)',
				'shadow-[0_0_0_1px_var(--line-card)] [tab-size:var(--code-tab-size,4)]',
				className
			)}
		>
			{titled ? (
				<div data-ui="code-block-head">
					<span data-ui="code-block-title">{title}</span>
					{copy ? <CopyButton value={source} iconOnly label="Copy code" /> : null}
				</div>
			) : null}
			<pre data-ui="code-block-content">
				{gutter ? (
					<span data-ui="code-block-gutter" aria-hidden="true">
						{gutterText(source, gutter)}
					</span>
				) : null}
				<code dangerouslySetInnerHTML={{ __html: html }} />
			</pre>
			{copy && !titled ? (
				<div data-ui="code-block-copy">
					<CopyButton value={source} iconOnly label="Copy code" className="bg-code" />
				</div>
			) : null}
		</div>
	);
}
