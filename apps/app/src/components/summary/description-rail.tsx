'use client';

import { Button, Icon, Skeleton } from '@recoder/ui';

import { useShowFyi } from '@/lib/bugs/show-fyi';
import type { BugsView, BugView } from '@/lib/bugs/types';

import { FindingLink } from './finding-link';
import { SummaryProse } from './prose';

interface DescriptionRailProps {
	bugs: BugsView;
	/** What the description says a reviewer should know. */
	notes: string[];
	/** True while no description is in hand: the notes stand as a skeleton. */
	standIn: boolean;
	onOpenFinding: (bug: BugView) => void;
	onOpenReview: () => void;
}

/** Beside the reading: every open finding of the newest review, then the description's notes. */
export function DescriptionRail({ bugs, notes, standIn, onOpenFinding, onOpenReview }: DescriptionRailProps) {
	return (
		<aside className="description-rail" aria-label="Findings and notes">
			<section className="summary-section" aria-labelledby="rail-findings-title">
				<div className="summary-section-head">
					<h2 id="rail-findings-title" className="summary-section-title">
						Findings
						{bugs.phase === 'ready' ? <span className="summary-count">{bugs.open.length}</span> : null}
					</h2>
					<Button variant="ghost" onClick={onOpenReview}>
						Open Review
						<Icon name="chevron_right" />
					</Button>
				</div>
				<RailFindings bugs={bugs} onOpenFinding={onOpenFinding} />
			</section>
			{notes.length > 0 ? (
				<section className="summary-section" aria-labelledby="rail-notes-title">
					<div className="summary-section-head">
						<h2 id="rail-notes-title" className="summary-section-title">
							Notes
							<span className="summary-count">{notes.length}</span>
						</h2>
					</div>
					<Skeleton id="description-notes" loading={standIn}>
						<ul className="description-notes">
							{notes.map((note) => (
								<li key={note}>
									<SummaryProse>{note}</SummaryProse>
								</li>
							))}
						</ul>
					</Skeleton>
				</section>
			) : null}
		</aside>
	);
}

/** The open findings, then the FYI notes unless hidden, or a quiet line when there are none or no review finished. */
function RailFindings({ bugs, onOpenFinding }: Pick<DescriptionRailProps, 'bugs' | 'onOpenFinding'>) {
	const fyiShown = useShowFyi((state) => state.shown);

	if (bugs.phase === 'none') return <p className="description-rail-quiet">No review has finished yet.</p>;
	if (bugs.phase !== 'ready') return null;

	if (bugs.open.length === 0 && (!fyiShown || bugs.fyi.length === 0)) {
		return <p className="description-rail-quiet">No open findings.</p>;
	}

	return (
		<ul className="finding-links">
			{[...bugs.open, ...(fyiShown ? bugs.fyi : [])].map((bug) => (
				<FindingLink key={bug.id} bug={bug} onOpen={onOpenFinding} />
			))}
		</ul>
	);
}
