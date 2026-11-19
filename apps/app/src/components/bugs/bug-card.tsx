'use client';

import { CaretDownIcon } from '@phosphor-icons/react';
import { memo, useId, useState } from 'react';

import { useAskView } from '@/lib/ask/use-ask';
import type { BugsView, BugView } from '@/lib/bugs/types';

import { AskComposer } from '@/components/ask/ask-composer';
import { AskSuggestions, AskThread } from '@/components/ask/ask-thread';

import { BugActions } from './bug-actions';
import { BugEvidence } from './bug-evidence';
import { shownCategory } from './bug-facts';

interface BugCardProps {
	bug: BugView;
	view: BugsView;
	open: boolean;
	onToggle: (id: string) => void;
	/** Under its line in the diff, or in the Review tab's list, where it also shows the proof. */
	place: 'diff' | 'review';
	/** On the Changes tab: the Review tab's address, for the menu's "Open in Review". */
	reviewHref?: string;
	/** True for a finding of the review before the one that runs now: its case stays readable, with nothing to act on. */
	stale?: boolean;
}

/** The conversation about one bug, under its actions. It loads only once the person asks. */
function BugAsk({ bugId }: { bugId: string }) {
	const ask = useAskView({ kind: 'bug', bugId });

	return (
		<div className="bug-ask">
			<AskThread ask={ask} />
			<AskSuggestions ask={ask} />
			<AskComposer ask={ask} label="Ask about this bug" />
		</div>
	);
}

/**
 * One finding, the same card under its line on the Changes tab and in the Review tab's list. Shut, it is one line:
 * its severity, title, category and place. Open, it is a raised card: the severity line over the title, what is
 * wrong, how it was shown (with the proof on the Review tab), the suggested fix and what to do with it; a stale one
 * keeps the case and drops the actions. It re-renders only when its own bug or state changes.
 */
export const BugCard = memo(function BugCard({ bug, view, open, onToggle, place, reviewHref, stale }: BugCardProps) {
	const bodyId = useId();
	const [asking, setAsking] = useState(false);
	const category = shownCategory(bug);

	return (
		<article
			id={`bug-${bug.id}`}
			className="bug-item"
			data-place={place}
			data-tone={bug.kind === 'suggestion' ? 'low' : bug.tone}
			data-open={open || undefined}
			data-stale={stale || undefined}
			data-bug={bug.id}
		>
			<button
				type="button"
				className="bug-head"
				aria-expanded={open}
				aria-controls={bodyId}
				data-finding={bug.id}
				onClick={() => onToggle(bug.id)}
			>
				<span className="bug-severity">
					<span aria-hidden className="bug-mark" />
					{bug.kind === 'suggestion' ? 'Suggestion' : bug.severity}
				</span>
				{category ? <span className="bug-category">{category}</span> : null}
				<span className="bug-title">{bug.title}</span>
				<span className="bug-where" title={bug.file}>
					{bug.where}
				</span>
				<CaretDownIcon aria-hidden className="bug-caret" />
			</button>
			{open ? (
				<div id={bodyId} className="bug-body">
					<BugEvidence bug={bug} full={place === 'review'} />
					{stale ? null : (
						<BugActions
							bug={bug}
							view={view}
							asking={asking}
							onAskToggle={() => setAsking(!asking)}
							reviewHref={reviewHref}
						/>
					)}
					{asking && !stale ? <BugAsk bugId={bug.id} /> : null}
				</div>
			) : null}
		</article>
	);
});
