'use client';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@recoder/ui';
import { CaretDownIcon } from '@phosphor-icons/react';
import { memo, useRef, useState, type KeyboardEvent } from 'react';

import { useAskView } from '@/lib/ask/use-ask';
import type { BugsView, BugView } from '@/lib/bugs/types';
import { typing } from '@/lib/shell/keys';

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

/** The nearest ancestor that scrolls up and down. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
	let at = element.parentElement;

	while (at && !/auto|scroll/.test(getComputedStyle(at).overflowY)) at = at.parentElement;

	return at;
}

/**
 * Keeps an open card's header where the person sees it as the card shuts. A header stuck over its own body would
 * ride up with the body as it folds away, so the card's top scrolls to where the header stands and the header never
 * moves; a header scrolled out of view comes back into it.
 */
function keepHeadInView(card: HTMLElement, head: HTMLElement): void {
	const stuck = head.getBoundingClientRect().top - card.getBoundingClientRect().top;

	if (stuck > 0) scrollerOf(card)?.scrollBy({ top: -stuck, behavior: 'instant' });
	else head.scrollIntoView({ block: 'nearest' });
}

/**
 * One finding, the same card under its line on the Changes tab and in the Review tab's list. Its header is one line,
 * open or shut: its severity, title, category, place and caret, and the whole line opens and shuts the card, with the
 * caret and the title in the same spot either way. Open, the card rises and unfolds under the header: what is wrong,
 * how it was shown (with the proof on the Review tab), the suggested fix and what to do with it; a stale one keeps the
 * case and drops the actions. On the Review tab an open card's header stays in view while its body scrolls, and
 * Escape inside the card shuts it. It re-renders only when its own bug or state changes.
 */
export const BugCard = memo(function BugCard({ bug, view, open, onToggle, place, reviewHref, stale }: BugCardProps) {
	const card = useRef<HTMLElement>(null);
	const head = useRef<HTMLButtonElement>(null);
	const [asking, setAsking] = useState(false);
	const category = shownCategory(bug);

	/** Opens a shut card; shuts an open one with its header kept in view. */
	function toggle(): void {
		if (open && card.current && head.current) keepHeadInView(card.current, head.current);

		onToggle(bug.id);
	}

	/** Escape inside an open card shuts it and leaves focus on its header, unless a field or a menu of its own has it. */
	function shutOnEscape(event: KeyboardEvent<HTMLElement>): void {
		const inside = event.currentTarget.contains(event.target as Node);

		if (event.key !== 'Escape' || !open || !inside || typing(event.target)) return;

		event.preventDefault();
		toggle();
		head.current?.focus({ preventScroll: true });
	}

	return (
		<Collapsible asChild open={open} onOpenChange={toggle}>
			<article
				ref={card}
				id={`bug-${bug.id}`}
				className="bug-item"
				data-place={place}
				data-tone={bug.kind === 'suggestion' ? 'low' : bug.tone}
				data-open={open || undefined}
				data-stale={stale || undefined}
				data-bug={bug.id}
				onKeyDown={shutOnEscape}
			>
				<CollapsibleTrigger ref={head} className="bug-head" data-finding={bug.id}>
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
				</CollapsibleTrigger>
				<CollapsibleContent className="bug-body">
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
				</CollapsibleContent>
			</article>
		</Collapsible>
	);
});
