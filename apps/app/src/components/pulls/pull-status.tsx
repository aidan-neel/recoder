'use client';

import { Button, Icon, Pill, Spinner, type ButtonStatus, type PillTone } from '@recoder/ui';

import { foundLabel, foundTone } from '@/lib/bugs/tiers';
import { plural } from '@/lib/shell/format';
import type { PullRowStatus } from '@/lib/pulls/types';

import { Age } from '@/components/common/age';
import { Link } from '@/components/common/link';

interface StatusFace {
	tone: PillTone;
	label: string;
}

/** The pill each status wears. The two statuses that ask for a review wear a button and have no face. */
function statusFace(status: PullRowStatus): StatusFace | null {
	switch (status.kind) {
		case 'reviewing':
			return { tone: 'low', label: 'Reviewing' };
		case 'bugs':
			return {
				tone: foundTone(status),
				label: foundLabel(status)
			};
		case 'review-failed':
			return { tone: 'danger', label: 'Review failed' };
		case 'conflicts':
			return { tone: 'medium', label: 'Merge conflicts' };
		case 'checks-failing':
			return { tone: 'danger', label: plural(status.failed, 'check') + ' failing' };
		case 'draft':
			return { tone: 'neutral', label: 'Draft' };
		case 'ready':
			return { tone: 'ok', label: 'Ready to merge' };
		case 'reviewed':
			return { tone: 'neutral', label: 'No bugs' };
		case 'not-reviewed':
		case 'outdated':
			return null;
	}
}

/** A status as its pill, or nothing for the statuses that ask for a review instead. */
export function StatusPill({ status }: { status: PullRowStatus }) {
	const face = statusFace(status);

	if (!face) return null;

	const lead = status.kind === 'reviewing' ? <Spinner size={11} /> : <span aria-hidden className="pill-dot" />;

	return (
		<Pill tone={face.tone} icon={status.kind === 'draft' || status.kind === 'reviewed' ? undefined : lead}>
			{face.label}
		</Pill>
	);
}

/** The statuses that say how the review went, so their pill opens the Review tab. */
const REVIEW_KINDS: ReadonlySet<PullRowStatus['kind']> = new Set(['reviewing', 'bugs', 'review-failed']);

interface PullStatusProps {
	status: PullRowStatus;
	/** The pull request's Review tab, where a pill about the review leads. */
	reviewHref: string;
	/** True while this row's review start is in flight. */
	starting: boolean;
	onReview: () => void;
}

/**
 * The one thing a row says about its pull request: a pill for a state, or
 * the Review button when the next step is a review, after "Cancelled" when a
 * person stopped the last one. A pull request with commits newer than its
 * review gets the quieter "Review again". A pill about
 * the review (reviewing, bugs, failed) is a link to the Review tab, beside
 * the row's own link rather than inside it.
 */
export function PullStatus({ status, reviewHref, starting, onReview }: PullStatusProps) {
	const pending: ButtonStatus = starting ? 'pending' : 'idle';
	const face = statusFace(status);

	if (face && REVIEW_KINDS.has(status.kind)) {
		return (
			<Button asChild variant="quiet" className="pill-link">
				<Link href={reviewHref} aria-label={`${face.label}, see the review`}>
					<StatusPill status={status} />
				</Link>
			</Button>
		);
	}

	if (face) return <StatusPill status={status} />;

	if (status.kind === 'outdated') {
		return (
			<Button variant="ghost" status={pending} onClick={onReview}>
				Review again
			</Button>
		);
	}

	return (
		<>
			{status.kind === 'not-reviewed' && status.cancelledAt ? (
				<span className="meta pull-row-cancelled">
					<Icon name="block" />
					Cancelled <Age at={status.cancelledAt} form="long" />
				</span>
			) : null}
			<Button variant="outline" status={pending} onClick={onReview}>
				Review
			</Button>
		</>
	);
}
