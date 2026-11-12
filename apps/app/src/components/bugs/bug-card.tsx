'use client';

import { Pill, StatusGlyph } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { memo, useId, useState } from 'react';

import { useAskView } from '@/lib/ask/use-ask';
import type { BugsView, BugView } from '@/lib/bugs/types';

import { AskSuggestions, AskThread } from '@/components/ask/ask-thread';
import { Composer } from '@/components/ask/composer';
import { EVIDENCE_TONES } from '@/components/changes/line-bug';

import { BugActions } from './bug-actions';
import { BugEvidence } from './bug-evidence';

/** What a finding that came from an earlier review of this pull request says about that. */
const HISTORY_LABELS = { carried: 'From the last review', rechecked: 'Checked again' } as const;

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
			<Composer
				label="Ask about this bug"
				placeholder="Ask about this bug"
				limit={ask.limit}
				busy={ask.replying}
				onStop={ask.stop}
				onSend={ask.send}
			/>
		</div>
	);
}

/**
 * One finding. Shut, it is a line: how serious, what, where, how it was
 * shown. Open, it is the whole case: the explanation, the proof, the fix and
 * what to do with it. It re-renders only when its own bug or state changes.
 */
export const BugCard = memo(function BugCard({ bug, view, open, onToggle }: BugCardProps) {
	const bodyId = useId();
	const [asking, setAsking] = useState(false);
	const history = bug.history === 'carried' || bug.history === 'rechecked' ? HISTORY_LABELS[bug.history] : null;

	return (
		<article id={`bug-${bug.id}`} className="bug-card" data-open={open || undefined} data-bug={bug.id}>
			<button
				type="button"
				className="bug-head"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => onToggle(bug.id)}
			>
				<StatusGlyph kind={bug.kind === 'suggestion' ? 'low' : bug.tone} label={bug.severity} />
				<span className="bug-title">{bug.title}</span>
				<span className="bug-head-end">
					{bug.kind === 'suggestion' ? <Pill tone="neutral">Suggestion</Pill> : null}
					<Pill tone={EVIDENCE_TONES[bug.evidence]}>{bug.evidenceLabel}</Pill>
					<ChevronDown aria-hidden />
				</span>
				<span className="meta bug-where">
					<span className="mono">{bug.where}</span>
					<span className="meta-sep">{bug.severity}</span>
					<span className="meta-sep">{bug.category}</span>
					{history ? <span className="meta-sep">{history}</span> : null}
				</span>
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
