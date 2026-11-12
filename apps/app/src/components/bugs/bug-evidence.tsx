'use client';

import { parseUnifiedDiff } from '@recoder/shared';
import { CodeLines, langForPath, Markdown } from '@recoder/ui';
import { Check } from 'lucide-react';
import { useMemo } from 'react';

import type { BugProof, BugView } from '@/lib/bugs/types';

/** The run that reproduces the bug: the command, how it ended, what it printed, and how the base branch compares. */
function ProofBlock({ proof }: { proof: BugProof }) {
	const failed = proof.exitCode !== null && proof.exitCode !== 0;

	return (
		<section className="proof" aria-label="The run that shows it">
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
			{proof.expected || proof.base ? (
				<div className="proof-foot">{[proof.expected, proof.base].filter(Boolean).join(' ')}</div>
			) : null}
		</section>
	);
}

/** How execution reaches the problem, one numbered step a row. */
function TraceBlock({ trace }: Pick<BugView, 'trace'>) {
	return (
		<section className="proof" aria-label="How execution reaches it">
			<div className="proof-head" data-plain>
				How execution reaches it
			</div>
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

/** The repository rule the bug breaks, word for word, with where it is written. */
function RuleBlock({ rule }: { rule: NonNullable<BugView['rule']> }) {
	const line = rule.source.line ? `:${rule.source.line}` : '';

	return (
		<section className="proof" aria-label="The rule it breaks">
			<div className="proof-head" data-plain>
				<span className="flex-1">Rule {rule.id}</span>
				<span className="mono text-fg-faint">
					{rule.source.path}
					{line}
				</span>
			</div>
			<blockquote className="rule-quote">{rule.text}</blockquote>
		</section>
	);
}

/** The first file of a suggested patch as lines for the kit; none when the patch does not parse. */
function usePatch(diff: string | null) {
	return useMemo(() => {
		const file = diff ? parseUnifiedDiff(diff)[0] : undefined;

		return file ? { path: file.path, lines: file.hunks.flatMap((hunk) => hunk.lines) } : null;
	}, [diff]);
}

/** The suggested fix: a patch the review checked, with the checks it passed, or the reviewer's words. */
function FixBlock({ fix }: { fix: NonNullable<BugView['fix']> }) {
	const patch = usePatch('diff' in fix ? fix.diff : null);

	if ('text' in fix) {
		return (
			<section className="proof" aria-label="Suggested fix">
				<div className="proof-head" data-plain>
					Suggested fix
				</div>
				<div className="proof-text">
					<Markdown>{fix.text}</Markdown>
				</div>
			</section>
		);
	}

	return (
		<section className="proof" aria-label="Suggested fix">
			<div className="proof-head" data-plain>
				<span className="flex-1">Suggested fix</span>
				{patch ? <span className="mono text-fg-faint">{patch.path}</span> : null}
			</div>
			{patch ? <CodeLines lines={patch.lines} lang={langForPath(patch.path)} /> : null}
			{!patch ? <pre className="proof-output">{fix.diff}</pre> : null}
			{fix.checks.length > 0 ? (
				<div className="fix-checks">
					{fix.checks.map((check) => (
						<span key={check}>
							<Check aria-hidden />
							{check}
						</span>
					))}
				</div>
			) : null}
		</section>
	);
}

/**
 * Everything that backs a bug, in the order a reader checks it: what is
 * wrong, the proof for its class of evidence (a run, a trace, a rule), then
 * the fix.
 */
export function BugEvidence({ bug }: { bug: BugView }) {
	return (
		<>
			<Markdown>{bug.explanation}</Markdown>
			{bug.proof ? <ProofBlock proof={bug.proof} /> : null}
			{bug.trace.length > 0 ? <TraceBlock trace={bug.trace} /> : null}
			{bug.rule ? <RuleBlock rule={bug.rule} /> : null}
			{bug.fix ? <FixBlock fix={bug.fix} /> : null}
		</>
	);
}
