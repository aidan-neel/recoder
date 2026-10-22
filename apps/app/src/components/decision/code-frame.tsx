'use client';

import { CodeLines, cn, langForPath } from '@recoder/ui';
import { Fragment, type ReactNode } from 'react';

import type { ExcerptLine, FileHunk } from '@/lib/review/excerpt';
import { plural } from '@/lib/shell/format';

interface CodeFrameProps {
	path: string;
	/** A new file: the header says so, since every line is an addition. */
	fresh: boolean;
	/** The right end of the header: an action, the checks a patch passed, the line counts. */
	aside?: ReactNode;
	children: ReactNode;
}

/** The code surface with its header row: the path (directory dimmed), "New file", and an aside. */
function CodeFrame({ path, fresh, aside, children }: CodeFrameProps) {
	const slash = path.lastIndexOf('/') + 1;

	return (
		<div
			data-ui="code-frame"
			className="min-w-0 overflow-hidden rounded-[10px] bg-code shadow-[0_0_0_1px_var(--line-card)]"
		>
			<div className="flex h-[38px] items-center gap-2.5 border-b border-line-divider pr-2 pl-3.5">
				<span className="min-w-0 truncate font-mono text-[11.5px] text-fg-secondary">
					<span className="text-fg-faint">{path.slice(0, slash)}</span>
					{path.slice(slash)}
				</span>
				{fresh ? <span className="shrink-0 text-[11.5px] text-fg-faint">New file</span> : null}
				<span className="flex-1" />
				{aside}
			</div>
			{children}
		</div>
	);
}

/** Code lines sitting inside a frame, which owns the ring and the corners. */
const FRAMED = 'rounded-none shadow-none';

interface CodeExcerptProps {
	path: string;
	fresh: boolean;
	lines: ExcerptLine[];
	above: number;
	below: number;
	aside?: ReactNode;
}

/** A few lines around what an item points at, with quiet rows for the lines left out. */
export function CodeExcerpt({ path, fresh, lines, above, below, aside }: CodeExcerptProps) {
	return (
		<CodeFrame path={path} fresh={fresh} aside={aside}>
			<CodeLines lines={lines} lang={langForPath(path)} gap={{ above, below }} className={FRAMED} />
		</CodeFrame>
	);
}

interface HunkCodeProps {
	path: string;
	fresh: boolean;
	hunks: FileHunk[];
	/** Diff lines a fold hides after the last hunk. */
	after?: number;
	/** Draws the code without highlighting, for a diff too long to color at once. */
	plain?: boolean;
	aside?: ReactNode;
	/** Content under a line, such as the decisions that end on it. */
	annotate?: (line: ExcerptLine) => ReactNode;
	className?: string;
}

/** "1 line hidden", "1,240 lines hidden": a quiet row where a fold hides diff lines. */
function FoldRow({ count }: { count: number }) {
	return (
		<div className="hunk-gap">
			{count.toLocaleString('en-US')} {count === 1 ? 'line' : 'lines'} hidden
		</div>
	);
}

/**
 * A whole diff, hunk by hunk. The unchanged lines between hunks are not in
 * the diff, so a quiet row stands for them instead of the numbers jumping;
 * lines a fold hides get a row of their own. A diff with no lines (a binary
 * file, a pure rename) says so instead of drawing an empty frame.
 */
export function HunkCode({ path, fresh, hunks, after = 0, plain = false, aside, annotate, className }: HunkCodeProps) {
	const lang = plain ? null : langForPath(path);

	return (
		<CodeFrame path={path} fresh={fresh} aside={aside}>
			<div className={cn('flex flex-col', className)}>
				{hunks.length === 0 ? <p className="hunk-empty">No text changes. The file is binary or only renamed.</p> : null}
				{hunks.map((hunk, index) => (
					<Fragment key={index}>
						{hunk.folded > 0 ? <FoldRow count={hunk.folded} /> : null}
						{hunk.skipped > 0 && index > 0 ? (
							<div className="hunk-gap">{plural(hunk.skipped, 'unchanged line')}</div>
						) : null}
						<CodeLines
							lines={hunk.lines}
							lang={lang}
							gap={{ above: index === 0 ? hunk.skipped : 0 }}
							annotate={annotate && ((at) => annotate(hunk.lines[at]))}
							className={FRAMED}
						/>
					</Fragment>
				))}
				{after > 0 ? <FoldRow count={after} /> : null}
			</div>
		</CodeFrame>
	);
}
