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
 * what to do with it. It re-renders only when its own bug or state changes.
 */
export const BugCard = memo(function BugCard({ bug, view, open, onToggle }: BugCardProps) {
	const bodyId = useId();
	const [asking, setAsking] = useState(false);

	return (
		<article id={`bug-${bug.id}`} className="bug-item" data-open={open || undefined} data-bug={bug.id}>
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
					<BugActions bug={bug} view={view} asking={asking} onAskToggle={() => setAsking(!asking)} />
					{asking ? <BugAsk bugId={bug.id} /> : null}
				</div>
			) : null}
		</article>
	);
});
