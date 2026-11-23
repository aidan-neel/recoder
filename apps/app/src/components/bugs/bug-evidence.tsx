'use client';

import { parseUnifiedDiff } from '@recoder/shared';
import { CodeBlock, CodeLines, type CodeLine, FileChip, langForPath, Markdown } from '@recoder/ui';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';

import type { BugView } from '@/lib/bugs/types';
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
						<CheckCircleIcon aria-hidden />
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

/** What backs a finding: the full explanation, how it was shown, and the suggested fix when it has one. */
export function BugEvidence({ bug }: { bug: BugView }) {
	return (
		<>
			<Markdown>{bug.explanation}</Markdown>
			{bug.moveReason ? (
				<section className="bug-section" aria-label="Why the move matters">
					<div className="bug-section-head">
						<h3 className="section-label">On moved code</h3>
					</div>
					<p className="bug-note">{bug.moveReason}</p>
				</section>
			) : null}
			<div className="bug-section-head">
				<EvidencePill bug={bug} />
				<HistoryPill bug={bug} />
			</div>
			{bug.fix ? <FixBlock fix={bug.fix} /> : null}
		</>
	);
}
