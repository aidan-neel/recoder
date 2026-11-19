'use client';

import { citedRuleWords, parseUnifiedDiff } from '@recoder/shared';
import { ClampedText, CodeLines, type CodeLine, langForPath, Markdown, Pill } from '@recoder/ui';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';

import type { BugProof, BugView } from '@/lib/bugs/types';
import { plural } from '@/lib/shell/format';

import { EvidencePill, HistoryPill } from './bug-facts';

/**
 * The run that reproduces the bug: the command, how it ended and what it
 * printed in one terminal box, then what it should have shown and how the
 * base branch compares as a quiet line under it.
 */
function ProofBlock({ proof }: { proof: BugProof }) {
	const failed = proof.exitCode !== null && proof.exitCode !== 0;
	const note = [proof.expected, proof.base].filter(Boolean).join(' ');

	return (
		<section className="bug-section" aria-label="The run that shows it">
			<div className="proof">
				<div className="proof-head">
					<span className="proof-command">{proof.command}</span>
					{proof.exitCode !== null ? (
						<span className="proof-exit" data-failed={failed || undefined}>
							exit {proof.exitCode}
						</span>
					) : null}
				</div>
				{proof.output ? (
					<pre className="proof-output" tabIndex={0}>
						{proof.output}
					</pre>
				) : null}
			</div>
			{note ? <p className="bug-note">{note}</p> : null}
		</section>
	);
}

/** How execution reaches the problem, one numbered step a row. */
function TraceBlock({ trace }: Pick<BugView, 'trace'>) {
	return (
		<section className="bug-section" aria-label="How execution reaches it">
			<h3 className="section-label">How execution reaches it</h3>
			<ol className="trace">
				{trace.map((step) => (
					<li key={step.where + step.note}>
						<span className="trace-where">{step.where}</span>
						<span className="trace-note">{step.note}</span>
					</li>
				))}
			</ol>
		</section>
	);
}

/**
 * The repository rule the bug breaks, with where it is written: its own words
 * as a quote, or Recoder's restatement as plain text when the file has no line
 * that says it word for word. A rule the file states as a preference says so.
 */
function RuleBlock({ rule }: { rule: NonNullable<BugView['rule']> }) {
	const line = rule.source.line ? `:${rule.source.line}` : '';
	const words = citedRuleWords(rule);

	return (
		<section className="bug-section" aria-label="The rule it breaks">
			<div className="bug-section-head">
				<h3 className="section-label">{rule.level === 'advisory' ? 'Advisory rule' : 'Rule'}</h3>
				<Pill face="code">{rule.id}</Pill>
				<Pill face="code" title={rule.source.path + line}>
					{rule.source.path}
					{line}
				</Pill>
			</div>
			{rule.verbatim === false ? (
				<p className="rule-restated">{words}</p>
			) : (
				<blockquote className="rule-quote">{words}</blockquote>
			)}
		</section>
	);
}

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
				{patch ? (
					<span className="fix-path" title={patch.path}>
						{patch.path.slice(patch.path.lastIndexOf('/') + 1)}
					</span>
				) : null}
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
			{'diff' in fix && !patch ? <pre className="proof-output">{fix.diff}</pre> : null}
		</section>
	);
}

interface BugEvidenceProps {
	bug: BugView;
	/** The Review tab's whole case: the run, the trace or the rule that shows it. The diff leaves them out. */
	full: boolean;
}

/**
 * What backs a finding, in the order a reader checks it: what is wrong (its first lines, the rest behind Show
 * more), how it was shown, the proof for its class of evidence on the Review tab, then the fix.
 */
export function BugEvidence({ bug, full }: BugEvidenceProps) {
	return (
		<>
			<ClampedText lines={3}>
				<Markdown>{bug.explanation}</Markdown>
			</ClampedText>
			<div className="bug-section-head">
				<EvidencePill bug={bug} />
				<HistoryPill bug={bug} />
			</div>
			{full && bug.proof ? <ProofBlock proof={bug.proof} /> : null}
			{full && bug.trace.length > 0 ? <TraceBlock trace={bug.trace} /> : null}
			{full && bug.rule ? <RuleBlock rule={bug.rule} /> : null}
			{bug.fix ? <FixBlock fix={bug.fix} /> : null}
		</>
	);
}
