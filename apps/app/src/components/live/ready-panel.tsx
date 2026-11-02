'use client';

import { AnimatedNumber, Button, Card, Keycap } from '@recoder/ui';

import { useCounts, usePhase, useSurface } from '@/components/review/review-view';
import { stateOf } from '@/lib/review/decisions';
import { useReview } from '@/lib/review/review-store';

/** "findings" while every open item is a finding; "decisions" once an open question is among them. */
function useOpenWord(open: number): string {
	const surface = useSurface();
	const records = useReview((state) => state.records);

	const questions = (surface?.decisions ?? []).some(
		(decision) => decision.kind === 'question' && stateOf(records, decision.id) === 'open'
	);

	const word = questions ? 'decision' : 'finding';

	return open === 1 ? `${word} is` : `${word}s are`;
}

/**
 * While the review runs with items already open (a continued review keeps
 * what it found), a card says they are ready and offers the way in: the
 * region's one filled button, which opens the riskiest, as Enter does on
 * the overview. While the review is paused, Resume holds the filled look,
 * so this one steps back to an outline. Hidden while nothing is open.
 */
export function ReadyPanel() {
	const { open } = useCounts();
	const select = useReview((state) => state.select);
	const nextOpen = useReview((state) => state.nextOpen);
	const word = useOpenWord(open);
	const paused = usePhase() === 'paused';

	if (open === 0) return null;

	return (
		<Card as="section" data-ui="live-ready" aria-labelledby="live-ready-title" className="live-ready">
			<div className="live-ready-text">
				<h2 id="live-ready-title" className="live-ready-title">
					<AnimatedNumber value={open} /> {word} ready to read
				</h2>
				<p className="live-ready-note">Start now; more may come before the review finishes.</p>
			</div>
			<Button
				variant={paused ? 'outline' : 'primary'}
				aria-label="Read the riskiest"
				aria-keyshortcuts="Enter"
				onClick={() => select(nextOpen(null))}
			>
				Read the riskiest <Keycap k="Enter" />
			</Button>
		</Card>
	);
}
