'use client';

import { parseUnifiedDiff } from '@recoder/shared';
import { Button, CodeBlock, CodeLines, FileChip, Icon, langForPath, Markdown, type CodeLine } from '@recoder/ui';
import { useMemo } from 'react';

import { useGoToOrigin } from '@/lib/bugs/move-origin';
import type { BugMove, BugView } from '@/lib/bugs/types';
import { plural } from '@/lib/shell/format';

import { EvidencePill, HistoryPill } from './bug-facts';

/** A suggested patch's first file: its path and its lines for the kit. */
interface Patch {
	path: string;
	lines: CodeLine[];
}

/** The first file of a suggested patch; none when the patch does not parse. */
function usePatch(diff: string | null): Patch | null {
	return useMemo(() => {
		const file = diff ? parseUnifiedDiff(diff)[0] : undefined;

		return file ? { path: file.path, lines: file.hunks.flatMap((hunk) => hunk.lines) } : null;
	}, [diff]);
}

/**
 * The suggested fix, open: a quiet head that says there is one, the file a patch changes and how many checks it
 * passed (named in its tooltip), over the patch as code, or the reviewer's words when it gave no patch.
 */
function FixBlock({ fix }: { fix: NonNullable<BugView['fix']> }) {
	const patch = usePatch('diff' in fix ? fix.diff : null);
	const checks = 'checks' in fix ? fix.checks : [];

	return (
		<section className="fix" aria-label="Suggested fix">
			<div className="fix-head">
				Suggested fix
				{patch ? <FileChip path={patch.path} className="fix-path" /> : null}
				{checks.length > 0 ? (
					<span className="fix-checks" title={checks.join(', ')}>
						<Icon name="check_circle" />
						{plural(checks.length, 'check')} passed
					</span>
				) : null}
			</div>
			{'text' in fix ? <Markdown className="fix-text">{fix.text}</Markdown> : null}
			{'diff' in fix && patch ? (
				<CodeLines lines={patch.lines} lang={langForPath(patch.path)} className="fix-code" />
			) : null}
			{'diff' in fix && !patch ? <CodeBlock code={fix.diff} lang="diff" className="fix-code" /> : null}
		</section>
	);
}

const MOVE_VERBS: Record<BugMove['kind'], string> = {
	moved: 'Moved from',
	copied: 'Copied from',
	renamed: 'Renamed from'
};

/**
 * A finding on moved code: where the code came from and where it went, each with its lines, whether it changed on the
 * way, and a way to its original place in Changes, as the moved block's note there reads; then why the move matters.
 */
function MovedCode({ move }: { move: BugMove }) {
	const goToOrigin = useGoToOrigin(move);

	return (
		<section className="bug-section" aria-label="On moved code">
			<div className="bug-section-head">
				<h3 className="section-label">On moved code</h3>
			</div>
			<div className="bug-move">
				<Icon name="subdirectory_arrow_right" className="move-note-icon" />
				<span>{MOVE_VERBS[move.kind]}</span>
				<FileChip path={move.from.path} line={move.from.lines} framed />
				<span>to</span>
				<FileChip path={move.to.path} line={move.to.lines} framed />
				{move.kind === 'renamed' ? null : (
					<span className="meta">{move.exact ? 'unchanged' : 'with a small change'}</span>
				)}
				{goToOrigin ? (
					<Button variant="ghost" size="sm" className="bug-move-go" onClick={goToOrigin}>
						Go to original
					</Button>
				) : null}
			</div>
			<p className="bug-note">{move.reason}</p>
		</section>
	);
}

/** What backs a finding: the full explanation, how it was shown, and the suggested fix when it has one. */
export function BugEvidence({ bug }: { bug: BugView }) {
	return (
		<>
			<Markdown>{bug.explanation}</Markdown>
			{bug.move ? <MovedCode move={bug.move} /> : null}
			<div className="bug-section-head">
				<EvidencePill bug={bug} />
				<HistoryPill bug={bug} />
			</div>
			{bug.fix ? <FixBlock fix={bug.fix} /> : null}
		</>
	);
}
