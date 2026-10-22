import { useMemo } from 'react';

import { cn } from '../../lib/cn';
import { CopyButton } from '../display/copy-button';
import { highlightCode } from './highlight';

interface CodeBlockProps {
	code: string;
	/** A highlight language (a fence name, an extension or `langForPath(path)`); plain text when null. */
	lang?: string | null;
	/** Adds a copy button at the top right, shown while the block is hovered or focused and while it confirms a copy. */
	copy?: boolean;
	/** Wraps long lines instead of scrolling them sideways. */
	wrap?: boolean;
	className?: string;
}

/** A highlighted block of code on the code surface, the one fenced code in Markdown uses. */
export function CodeBlock({ code, lang = null, copy = false, wrap = false, className }: CodeBlockProps) {
	const source = code.replace(/\n$/, '');
	const html = useMemo(() => highlightCode(source, lang), [source, lang]);

	return (
		<div
			data-ui="code-block"
			data-layout={source.includes('\n') ? 'multi-line' : 'single-line'}
			data-wrap={wrap || undefined}
			data-copy={copy || undefined}
			className={cn(
				'relative min-w-0 overflow-hidden rounded-[10px] bg-code font-mono text-[12.5px] leading-5 text-(--syn-plain)',
				'shadow-[0_0_0_1px_var(--line-card)] [tab-size:4]',
				className
			)}
		>
			<pre data-ui="code-block-content" className="thin-scroll">
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
