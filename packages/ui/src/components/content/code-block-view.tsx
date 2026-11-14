import { cn } from '../../lib/cn';
import { CopyButton } from '../display/copy-button';

/** The code a block shows: the source without its final newline, so a fenced block ends on its last line. */
export function codeSource(code: string): string {
	return code.replace(/\n$/, '');
}

interface CodeBlockViewProps {
	/** The code, through `codeSource`. */
	source: string;
	/** `source` as HTML: highlighted, or escaped plain text. Both take the same lines, so a swap never moves. */
	html: string;
	copy?: boolean;
	wrap?: boolean;
	className?: string;
}

/**
 * The code block's markup with its HTML already made. It holds no hooks, so
 * `CodeBlock` renders it on the client and `StaticMarkdown` in a server
 * component.
 */
export function CodeBlockView({ source, html, copy = false, wrap = false, className }: CodeBlockViewProps) {
	return (
		<div
			data-ui="code-block"
			data-layout={source.includes('\n') ? 'multi-line' : 'single-line'}
			data-wrap={wrap || undefined}
			data-copy={copy || undefined}
			className={cn(
				'relative min-w-0 overflow-hidden rounded-(--radius-row) bg-code font-mono text-[12.5px] leading-5 text-(--syn-plain)',
				'shadow-[0_0_0_1px_var(--line-card)] [tab-size:4]',
				className
			)}
		>
			<pre data-ui="code-block-content">
				<code dangerouslySetInnerHTML={{ __html: html }} />
			</pre>
			{copy ? (
				<div data-ui="code-block-copy">
					<CopyButton value={source} iconOnly label="Copy code" className="bg-code" />
				</div>
			) : null}
		</div>
	);
}
