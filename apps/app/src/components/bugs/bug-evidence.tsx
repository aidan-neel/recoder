'use client';

import { citedRuleWords, parseUnifiedDiff } from '@recoder/shared';
import {
	ClampedText,
	CodeLines,
	type CodeLine,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	langForPath,
	Markdown,
	Pill
} from '@recoder/ui';
import { Check, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import type { BugProof, BugView } from '@/lib/bugs/types';
import { plural } from '@/lib/shell/format';

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

/** The fix itself: the patch as code with the checks it passed, else the reviewer's words. */
function FixBody({ fix, patch }: { fix: NonNullable<BugView['fix']>; patch: Patch | null }) {
	if ('text' in fix) return <Markdown>{fix.text}</Markdown>;

	return (
		<>
			<div className="proof">
				{patch ? <CodeLines lines={patch.lines} lang={langForPath(patch.path)} /> : null}
				{!patch ? <pre className="proof-output">{fix.diff}</pre> : null}
			</div>
			{fix.checks.length > 0 ? (
				<div className="bug-section-head">
					{fix.checks.map((check) => (
						<Pill key={check} face="code" tone="ok" icon={<Check aria-hidden />}>
							{check}
						</Pill>
					))}
				</div>
			) : null}
		</>
	);
}

/**
 * The suggested fix, shut until the reader opens it: one line that says
 * there is one, the file a patch changes and how many checks it passed.
 */
function FixBlock({ fix }: { fix: NonNullable<BugView['fix']> }) {
	const patch = usePatch('diff' in fix ? fix.diff : null);

	return (
		<Collapsible className="bug-section">
			<CollapsibleTrigger className="fix-head">
				<ChevronRight aria-hidden />
				Suggested fix
				{patch ? (
					<Pill face="code" title={patch.path}>
						{patch.path}
					</Pill>
				) : null}
				{'checks' in fix && fix.checks.length > 0 ? (
					<Pill tone="ok" icon={<Check aria-hidden />}>
						{plural(fix.checks.length, 'check')} passed
					</Pill>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent className="fix-body">
				<FixBody fix={fix} patch={patch} />
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * Everything that backs a bug, in the order a reader checks it: what is
 * wrong (its first lines, the rest behind Show more), the proof for its class
 * of evidence (a run, a trace, a rule), then the fix, shut.
 */
export function BugEvidence({ bug }: { bug: BugView }) {
	return (
		<>
			<ClampedText lines={2}>
				<Markdown>{bug.explanation}</Markdown>
			</ClampedText>
			{bug.proof ? <ProofBlock proof={bug.proof} /> : null}
			{bug.trace.length > 0 ? <TraceBlock trace={bug.trace} /> : null}
			{bug.rule ? <RuleBlock rule={bug.rule} /> : null}
			{bug.fix ? <FixBlock fix={bug.fix} /> : null}
		</>
	);
}
