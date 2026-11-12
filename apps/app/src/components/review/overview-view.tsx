'use client';

import { AnimatedNumber, HoverList, Markdown, RowButton } from '@recoder/ui';
import { Check } from 'lucide-react';
import { useState } from 'react';

import { InlineText } from '@/components/common/inline-text';
import type { ReviewPhase } from '@/lib/review/lifecycle';
import { useReview } from '@/lib/review/review-store';
import type { Surface } from '@/lib/review/surface';

import { ChangeMap } from './change-map';
import { CiChecks } from './ci-checks';
import { ReadFailed, shownFailure } from './read-failed';
import { ReviewNotice } from './review-notice';
import { CheckedSkeleton, CiSkeleton } from './review-skeleton';
import { useCounts, useOutdated, usePhase, useSurface } from './review-view';
import { DecisionsBlock } from './verdict';

/**
 * What changed: how many changed lines still need a person, and the bar that
 * splits them. A review without changed lines leaves this out: a diff that
 * came back empty, or failed to load, says so once, in the rail's Files
 * group, where the diff lives.
 */
function WhatChanged({ surface }: { surface: Surface }) {
	const { attention, minutes } = surface;

	if (attention.total === 0) return null;

	return (
		<section className="overview-block" aria-labelledby="overview-lead">
			<h2 className="overview-lead" id="overview-lead">
				{attention.read === 0 ? (
					<>
						Nothing left to read.{' '}
						<span className="overview-lead-rest">
							All {attention.total} changed lines are checked, tests or mechanical.
						</span>
					</>
				) : (
					<>
						<AnimatedNumber value={attention.read} /> of {attention.total} changed lines need your eyes.{' '}
						<span className="overview-lead-rest">About {minutes} min.</span>
					</>
				)}
			</h2>
			<ChangeMap attention={attention} />
		</section>
	);
}

/**
 * True while the checks may still land: none are known yet, or they failed
 * before the pull request answered, whose line may speak for them. The store
 * holds the checks unknown in that case already; this keeps the place held
 * even for a copy that kept an empty list.
 */
function useChecksPending(): boolean {
	return useReview(
		(state) =>
			state.review?.source !== 'stub' && (state.checks === null || (state.checksError !== null && !state.pullAnswered))
	);
}

/**
 * Checked for you: each question a reviewer settled, opening its receipt,
 * then CI. The checks usually paint with the page; a slow forge's land later
 * in a place held for them, last, so their arrival moves nothing above.
 */
function CheckedBlock({ surface }: { surface: Surface }) {
	const checks = useReview((state) => state.checks);
	const checksFailed = useReview((state) => shownFailure(state, 'checks') !== null);
	const select = useReview((state) => state.select);
	const pending = useChecksPending();
	const ran = surface.receipts.filter((receipt) => receipt.evidence?.command).length;
	const receipts = surface.receipts.length > 0;

	if (!receipts && !checks?.length && !checksFailed) return pending ? <CheckedSkeleton /> : null;

	return (
		<section className="overview-block" aria-labelledby="overview-checked">
			<h2 className="overview-section-title" id="overview-checked">
				Checked for you
				{receipts ? <span className="overview-section-count tabular">{surface.receipts.length}</span> : null}
				{ran ? <span className="overview-section-note">{ran} by running code</span> : null}
			</h2>
			{receipts ? (
				<HoverList as="ul" itemSelector="li" className="overview-receipts" highlightClassName="rounded-[8px]">
					{surface.receipts.map((receipt) => (
						<li key={receipt.id}>
							<RowButton className="overview-receipt" onClick={() => select({ kind: 'receipt', id: receipt.id })}>
								<span className="overview-receipt-check" aria-hidden>
									<Check size={11} strokeWidth={2.5} />
								</span>
								<span>
									<InlineText text={receipt.question} />
								</span>
							</RowButton>
						</li>
					))}
				</HoverList>
			) : null}
			{checks?.length ? <CiChecks checks={checks} /> : pending && receipts ? <CiSkeleton /> : null}
			<ReadFailed part="checks" className="ci-failed" />
		</section>
	);
}

/**
 * True when the "New commits" notice came after the overview first drew: the
 * pull request's lookup answered late, or a refresh found new commits. That
 * notice then goes last, where its arrival moves nothing, rather than push the
 * summary down. One known as the overview first draws stays on top, as do the
 * failed and cancelled notices, which never wait for the lookup.
 */
function useLateNotice(phase: ReviewPhase): boolean {
	const outdated = useOutdated();
	const [atFirstDraw] = useState(outdated);

	return phase === 'passed' && outdated && !atFirstDraw;
}

/**
 * The overview: any notice the review needs, the summary in the AI voice,
 * what changed, what needs a decision (or the verdict) and what was checked.
 * A pull request lookup that failed, or one that found new commits after the
 * overview drew, says so last, where it moves nothing.
 */
export function OverviewView() {
	const surface = useSurface();
	const phase = usePhase();
	const late = useLateNotice(phase);
	const { total } = useCounts();
	const stopped = phase === 'failed' || phase === 'cancelled';

	if (!surface) return null;

	/** A review that stopped early has not read every line, so it never says nothing is left. */
	const showChanged = !(stopped && surface.attention.total > 0 && surface.attention.read === 0);

	return (
		<div data-ui="overview" className="overview">
			{late ? null : <ReviewNotice />}
			{surface.intent && !stopped ? (
				<Markdown variant="ai" className="overview-intent">
					{surface.intent}
				</Markdown>
			) : null}
			{showChanged ? <WhatChanged surface={surface} /> : null}
			{stopped && total === 0 ? null : <DecisionsBlock />}
			<CheckedBlock surface={surface} />
			<ReadFailed part="pull" className="overview-block" />
			{late ? (
				<div className="overview-block">
					<ReviewNotice />
				</div>
			) : null}
		</div>
	);
}
