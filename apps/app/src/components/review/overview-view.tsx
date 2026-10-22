'use client';

import { AnimatedNumber, HoverList, Markdown, RowButton, Skeleton } from '@recoder/ui';
import { Check } from 'lucide-react';

import { useReview } from '@/lib/review/review-store';
import type { Surface } from '@/lib/review/surface';

import { ChangeMap } from './change-map';
import { CiChecks } from './ci-checks';
import { InlineText } from '@/components/common/inline-text';
import { ReviewNotice } from './review-notice';
import { useCounts, usePhase, useShownReview, useSurface } from './review-view';
import { DecisionsBlock } from './verdict';

/** What changed: how many changed lines still need a person, and the bar that splits them. */
function WhatChanged({ surface }: { surface: Surface }) {
	const { attention, minutes } = surface;

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

/** Pill widths for checks that have not answered yet. */
const PENDING_CHECKS = ['w-[86px]', 'w-[104px]', 'w-[72px]'];

/**
 * The CI row while the forge answers. It holds the row's height, so the
 * receipts below do not jump when the checks arrive.
 */
function CiSkeleton() {
	return (
		<div className="ci" aria-hidden>
			{PENDING_CHECKS.map((width) => (
				<Skeleton key={width} className={`h-[26px] rounded-[8px] ${width}`} />
			))}
		</div>
	);
}

/** Checked for you: CI, then each question a reviewer settled, opening its receipt. */
function CheckedBlock({ surface }: { surface: Surface }) {
	const review = useShownReview();
	const checks = useReview((state) => state.checks);
	const select = useReview((state) => state.select);
	const ran = surface.receipts.filter((receipt) => receipt.evidence?.command).length;
	const checksPending = checks === null && review.source !== 'stub';

	if (surface.receipts.length === 0 && !checks?.length && !checksPending) return null;

	return (
		<section className="overview-block" aria-labelledby="overview-checked">
			<h2 className="overview-section-title" id="overview-checked">
				Checked for you
				{surface.receipts.length ? (
					<span className="overview-section-count tabular">{surface.receipts.length}</span>
				) : null}
				{ran ? <span className="overview-section-note">{ran} by running code</span> : null}
			</h2>
			{checksPending ? <CiSkeleton /> : null}
			{checks?.length ? <CiChecks checks={checks} /> : null}
			{surface.receipts.length ? (
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
		</section>
	);
}

/**
 * The overview: any notice the review needs, the summary in the AI voice,
 * what changed, what needs a decision (or the verdict) and what was checked.
 */
export function OverviewView() {
	const surface = useSurface();
	const phase = usePhase();
	const { total } = useCounts();
	const stopped = phase === 'failed' || phase === 'cancelled';

	if (!surface) return null;

	/** A review that stopped early has not read every line, so it never says nothing is left. */
	const showChanged = surface.attention.total > 0 && !(stopped && surface.attention.read === 0);

	return (
		<div data-ui="overview" className="overview">
			<ReviewNotice />
			{surface.intent && !stopped ? (
				<Markdown variant="ai" className="overview-intent">
					{surface.intent}
				</Markdown>
			) : null}
			{showChanged ? <WhatChanged surface={surface} /> : null}
			{stopped && total === 0 ? null : <DecisionsBlock />}
			<CheckedBlock surface={surface} />
		</div>
	);
}
