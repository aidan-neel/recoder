'use client';

import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Pill, StatusGlyph } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BugsView, BugView, UnresolvedItem } from '@/lib/bugs/types';
import { plural } from '@/lib/shell/format';
import { errorToast } from '@/lib/shell/notify';

interface GroupProps {
	title: string;
	/** The quiet text at the end of the line: a count. */
	meta: string;
	children: ReactNode;
}

/** A group under the open bugs: one quiet line that opens to its rows. */
function Group({ title, meta, children }: GroupProps) {
	return (
		<Collapsible>
			<CollapsibleTrigger className="bug-group-head">
				<ChevronRight aria-hidden />
				{title}
				<span className="meta">{meta}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="bug-group-list">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

interface BugLineProps {
	bug: BugView;
	/** What stands under the title: a quiet sentence, or badges. */
	detail: ReactNode;
	children?: ReactNode;
}

/** A bug as one line in a group: its title over its detail, then what can be done with it. */
function BugLine({ bug, detail, children }: BugLineProps) {
	return (
		<div className="bug-line">
			<div className="bug-line-text">
				<span className="bug-line-title">{bug.title}</span>
				{detail}
			</div>
			{children}
		</div>
	);
}

/** Where a bug is, as a badge; the full path on hover. */
function WherePill({ bug }: { bug: BugView }) {
	return (
		<Pill face="code" title={bug.file}>
			{bug.where}
		</Pill>
	);
}

/** Shows why a write did not go through. */
function refused(error: unknown): void {
	errorToast(error instanceof Error && error.message ? error.message : 'That did not go through.');
}

/** Where the bug is and what a person decided about it, as badges. */
function DecisionFacts({ bug }: { bug: BugView }) {
	const accepted = bug.decision?.state === 'accepted';

	return (
		<span className="bug-line-facts">
			<WherePill bug={bug} />
			<Pill tone={accepted ? 'ok' : 'neutral'}>{accepted ? 'Accepted' : 'Dismissed'}</Pill>
		</span>
	);
}

const UNRESOLVED_LABELS: Record<UnresolvedItem['kind'], string> = {
	question: 'Open question',
	prerequisite: 'Check did not run',
	skipped: 'Not investigated'
};

/**
 * Everything the review reports that is not an open bug: what a person
 * decided, what the newest commits fixed, topics that were quieted, work the
 * review could not finish, and what it checked and found sound. Each is one
 * line until opened, so the open bugs stay the page.
 */
export function BugGroups({ view }: { view: BugsView }) {
	return (
		<>
			{view.unresolved.length > 0 ? (
				<Group title="Not finished" meta={plural(view.unresolved.length, 'item')}>
					{view.unresolved.map((item) => (
						<div key={item.id} className="bug-line">
							<div className="bug-line-text">
								<span className="bug-line-title">{item.title}</span>
								<span className="meta">{item.detail}</span>
							</div>
							<Pill tone="question">{UNRESOLVED_LABELS[item.kind]}</Pill>
						</div>
					))}
				</Group>
			) : null}
			{view.decided.length > 0 ? (
				<Group title="Decided" meta={plural(view.decided.length, 'bug')}>
					{view.decided.map((bug) => (
						<BugLine key={bug.id} bug={bug} detail={<DecisionFacts bug={bug} />}>
							<Button
								variant="ghost"
								size="sm"
								disabled={view.pending.has(bug.id)}
								onClick={() => view.reopen(bug.id).catch(refused)}
							>
								Reopen
							</Button>
						</BugLine>
					))}
				</Group>
			) : null}
			{view.resolved.length > 0 ? (
				<Group title="Fixed since the last review" meta={plural(view.resolved.length, 'bug')}>
					{view.resolved.map(({ bug, reason }) => (
						<BugLine key={bug.id} bug={bug} detail={<span className="meta">{reason}</span>}>
							<StatusGlyph kind="ok" label="Fixed" />
						</BugLine>
					))}
				</Group>
			) : null}
			{view.quieted.length > 0 ? (
				<Group title="Quieted" meta={plural(view.quieted.length, 'bug')}>
					{view.quieted.map((bug) => (
						<BugLine
							key={bug.id}
							bug={bug}
							detail={
								<span className="bug-line-facts" title={`${bug.category} is often dismissed here`}>
									<WherePill bug={bug} />
									<Pill>{bug.category}</Pill>
								</span>
							}
						>
							<Button
								variant="ghost"
								size="sm"
								disabled={view.pending.has(bug.id)}
								onClick={() => view.unquiet(bug.id).catch(refused)}
							>
								Show these again
							</Button>
						</BugLine>
					))}
				</Group>
			) : null}
			{view.checked.claims > 0 ? (
				<div className="bug-group-head" role="note">
					<StatusGlyph kind="ok" />
					Checked, no issue found
					<span className="meta">
						{plural(view.checked.claims, 'claim')}
						<span className="meta-sep">{view.checked.cleared} cleared</span>
					</span>
				</div>
			) : null}
		</>
	);
}
