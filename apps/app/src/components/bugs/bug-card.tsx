'use client';

import { ChevronDown } from 'lucide-react';
import { memo, useId, useState } from 'react';

import { useAskView } from '@/lib/ask/use-ask';
import type { BugsView, BugView } from '@/lib/bugs/types';

import { AskComposer } from '@/components/ask/ask-composer';
import { AskSuggestions, AskThread } from '@/components/ask/ask-thread';

import { BugActions } from './bug-actions';
import { BugEvidence } from './bug-evidence';
import { BugFacts } from './bug-facts';

interface BugCardProps {
	bug: BugView;
	view: BugsView;
	open: boolean;
	onToggle: (id: string) => void;
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
 * One finding, a row of the list. Shut, it is its title over its facts as
 * badges. Open, it is the whole case: the explanation, the proof, the fix and
 * what to do with it; a stale one keeps the case and drops the actions. It
 * re-renders only when its own bug or state changes.
 */
export const BugCard = memo(function BugCard({ bug, view, open, onToggle, stale }: BugCardProps) {
	const bodyId = useId();
	const [asking, setAsking] = useState(false);

	return (
		<article
			id={`bug-${bug.id}`}
			className="bug-item"
			data-open={open || undefined}
			data-stale={stale || undefined}
			data-bug={bug.id}
		>
			<button
				type="button"
				className="bug-head"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => onToggle(bug.id)}
			>
				<span className="bug-title">{bug.title}</span>
				<ChevronDown aria-hidden />
				<BugFacts bug={bug} />
			</button>
			{open ? (
				<div id={bodyId} className="bug-body">
					<BugEvidence bug={bug} />
					{stale ? null : <BugActions bug={bug} view={view} asking={asking} onAskToggle={() => setAsking(!asking)} />}
					{asking && !stale ? <BugAsk bugId={bug.id} /> : null}
				</div>
			) : null}
		</article>
	);
});
