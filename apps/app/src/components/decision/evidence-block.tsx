'use client';

import { CodeBlock, Pill } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { Evidence } from '@/lib/review/surface';

/** What running the same command on the base branch says about who introduced the problem. */
function baseNote(result: string): string {
	if (result === 'regression') return 'Passes on the base branch, so this pull request introduced it.';
	if (result === 'pre-existing') return 'Fails the same way on the base branch: it predates this pull request.';

	return `Base branch: ${result}.`;
}

/** A label in the left column and its value beside it. */
function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="evidence-row">
			<span className="text-[12px] text-fg-faint">{label}</span>
			{children}
		</div>
	);
}

/**
 * What a reviewer ran and what it printed: the input it tried, the command
 * (copyable, wrapped so a narrow pane never hides its end, exit code beside
 * it), what it expected, the output, and how the base branch behaved.
 */
export function EvidenceBlock({ evidence }: { evidence: Evidence }) {
	const failed = evidence.exitCode !== null && evidence.exitCode !== 0;

	return (
		<figure className="evidence">
			{evidence.input ? (
				<Row label="Tried">
					<span className="evidence-value">{evidence.input}</span>
				</Row>
			) : null}
			{evidence.command ? (
				<Row label="Ran">
					<CodeBlock
						code={evidence.command}
						lang="bash"
						copy
						wrap
						className="evidence-command bg-transparent text-[12px] shadow-none"
					/>
					{evidence.exitCode !== null ? (
						<Pill tone={failed ? 'high' : 'ok'} className="font-mono">
							exit {evidence.exitCode}
						</Pill>
					) : null}
				</Row>
			) : null}
			{evidence.expected ? (
				<Row label="Expected">
					<span className="evidence-value">{evidence.expected}</span>
				</Row>
			) : null}
			{evidence.observed ? (
				<CodeBlock code={evidence.observed} className="evidence-output mt-1 bg-canvas text-[12px]" />
			) : null}
			{evidence.baseResult ? (
				<figcaption className="text-[12.5px] text-fg-subtle">{baseNote(evidence.baseResult)}</figcaption>
			) : null}
		</figure>
	);
}
