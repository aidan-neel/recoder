'use client';

import { Button, Keycap } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';

import { useReview } from '@/lib/review/review-store';
import { plural } from '@/lib/shell/format';

import { DecisionTally } from './decision-tally';
import { forgeName, isWorking, useCounts, usePhase, useShownReview, useSurface } from './review-view';

/** Decisions in each final state, as the verdict counts them. */
interface Decided {
	total: number;
	accepted: number;
	sent: number;
	dismissed: number;
}

/** What stays with the pull request: "2 accepted as is, 1 marked not an issue." */
function keptLine({ accepted, dismissed }: Decided): string {
	const parts = [
		accepted > 0 ? `${accepted} accepted as is` : null,
		dismissed > 0 ? `${dismissed} marked not an issue` : null
	].filter(Boolean);

	return parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing accepted as is.';
}

/** The verdict's sentence: what happens to this pull request, given the decisions made. */
function verdictLine(counts: Decided, working: boolean): { lead: string; rest: string } {
	if (counts.total === 0)
		return { lead: 'Nothing needs a decision.', rest: 'The reviewers found no problems worth your time.' };

	if (working) return { lead: 'Every decision so far is made.', rest: 'More may come while the review runs.' };

	if (counts.sent > 0) {
		return {
			lead: `${plural(counts.sent, 'item')} go${counts.sent === 1 ? 'es' : ''} back to the agent.`,
			rest: keptLine(counts)
		};
	}

	return { lead: 'Every decision is made.', rest: `Nothing goes back to the agent. ${keptLine(counts)}` };
}

/** Once nothing is open: the verdict in the AI voice, with hand off or approve on the forge. */
function Verdict() {
	const review = useShownReview();
	const pull = useReview((state) => state.pull);
	const setHandoffOpen = useReview((state) => state.setHandoffOpen);
	const counts = useCounts();
	const working = isWorking(usePhase());
	const { lead, rest } = verdictLine(counts, working);
	const forge = forgeName(review);
	const url = forge ? (review.prUrl ?? pull?.url ?? null) : null;
	const sent = counts.sent > 0;

	return (
		<section data-ui="verdict" className="verdict" data-sent={sent} aria-labelledby="verdict-title">
			<h2 className="verdict-title ai-voice" id="verdict-title">
				<span className="text-fg">{lead}</span> <span className="verdict-rest">{rest}</span>
			</h2>
			<div className="verdict-actions">
				{sent ? (
					<Button
						variant="primary"
						aria-label="Hand off to the agent"
						aria-keyshortcuts="H"
						onClick={() => setHandoffOpen(true)}
					>
						Hand off to the agent <Keycap k="h" />
					</Button>
				) : url && !working ? (
					<Button variant="primary" asChild>
						<a href={url} target="_blank" rel="noreferrer">
							Approve on {forge} <ArrowUpRight />
						</a>
					</Button>
				) : null}
				{sent && url ? (
					<Button variant="ghost" asChild>
						<a href={url} target="_blank" rel="noreferrer">
							Open on {forge} <ArrowUpRight />
						</a>
					</Button>
				) : null}
			</div>
		</section>
	);
}

/**
 * Needs you, on the overview: the tally and the way in while decisions are
 * open, then the verdict. A review that found nothing shows the verdict alone.
 */
export function DecisionsBlock() {
	const surface = useSurface();
	const select = useReview((state) => state.select);
	const nextOpen = useReview((state) => state.nextOpen);
	const { total, open } = useCounts();

	if (!surface) return null;

	if (total === 0) return <Verdict />;

	const reproduced = surface.decisions.filter((decision) => decision.proof === 'reproduced').length;

	return (
		<section className="overview-block" aria-labelledby="overview-decisions">
			<h2 className="overview-section-title" id="overview-decisions">
				Needs you
				<span className="overview-section-note">
					<DecisionTally />
					<span className="tabular">
						{total - open} of {total} decided
					</span>
				</span>
			</h2>
			{open > 0 ? (
				<div className="overview-start">
					<Button
						variant="primary"
						aria-label="Start with the riskiest"
						aria-keyshortcuts="Enter"
						onClick={() => select(nextOpen(null))}
					>
						Start with the riskiest <Keycap k="Enter" />
					</Button>
					<span className="overview-start-note">
						{plural(open, 'decision')} left{reproduced ? `, ${reproduced} reproduced by running code` : ''}.
					</span>
				</div>
			) : (
				<Verdict />
			)}
		</section>
	);
}
