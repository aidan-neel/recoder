'use client';

import { stateOf } from '@/lib/review/decisions';
import { decisionCounts, useReview } from '@/lib/review/review-store';
import { useShallow } from 'zustand/react/shallow';

import { useSurface } from './review-view';

/** Past this many, pips stop reading as a count, so the tally becomes a bar split by outcome. */
const MAX_PIPS = 12;

const OUTCOMES = ['accepted', 'sent', 'dismissed', 'open'] as const;

/** One pip per decision, filled by its outcome as it is made; a bar split by outcome past twelve. */
export function DecisionTally() {
	const decisions = useSurface()?.decisions ?? [];
	const records = useReview((state) => state.records);
	const counts = useReview(useShallow(decisionCounts));

	if (decisions.length > MAX_PIPS) {
		return (
			<span data-ui="decision-tally" className="tally" aria-hidden>
				<span className="tally-bar">
					{OUTCOMES.map((outcome) => (
						<span key={outcome} className="tally-seg" data-state={outcome} style={{ flexGrow: counts[outcome] }} />
					))}
				</span>
			</span>
		);
	}

	return (
		<span data-ui="decision-tally" className="tally" aria-hidden>
			{decisions.map((decision) => (
				<span
					key={decision.id}
					className="tally-pip"
					data-state={stateOf(records, decision.id)}
					data-tone={decision.tone}
				/>
			))}
		</span>
	);
}
