'use client';

import { Button, Card } from '@recoder/ui';
import { CircleAlert, CircleSlash, GitCommitHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { handFocus, takeFocus } from '@/lib/live/focus-handoff';
import { lifecycle } from '@/lib/review/lifecycle';
import { useReview } from '@/lib/review/review-store';
import { SETTINGS_HREF } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

import { ActionButton } from './action-button';
import { openReviewAgain, useCounts, useOutdated, usePhase, useShownReview } from './review-view';

interface NoticeProps {
	icon: ReactNode;
	title: string;
	body: ReactNode;
	tone: 'danger' | 'neutral';
	children: ReactNode;
}

/**
 * A review-level notice: why the review is not the last word, and the way
 * forward. When it replaces the live view after a confirmed cancel, its
 * first action takes focus, so focus does not fall to the page.
 */
function Notice({ icon, title, body, tone, children }: NoticeProps) {
	const actions = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => takeFocus('notice', actions.current?.querySelector<HTMLElement>('button') ?? null), []);

	return (
		<Card data-ui="review-notice" data-tone={tone} className="review-notice">
			<span className="review-notice-icon" aria-hidden>
				{icon}
			</span>
			<div className="review-notice-text">
				<p className="review-notice-title">{title}</p>
				<p className="review-notice-body">{body}</p>
			</div>
			<div ref={actions} className="review-notice-actions">
				{children}
			</div>
		</Card>
	);
}

/** The first seven characters of a commit, for prose. */
function short(sha: string): string {
	return sha.slice(0, 7);
}

/**
 * The notice a finished review may need at the top of its overview: it
 * failed (Continue), it was cancelled (Continue or Review again), or commits
 * landed after it (Review again). A failed review of an old commit is
 * reviewed again rather than continued. A model that ran out of usage is
 * named, with settings one click away to pick another.
 */
export function ReviewNotice() {
	const review = useShownReview();
	const phase = usePhase();
	const outdated = useOutdated();
	const pull = useReview((state) => state.pull);
	const failure = useReview((state) => state.progress?.failure ?? null);
	const { total } = useCounts();
	const navigate = useShell((state) => state.navigate);
	const again = <ActionButton run={() => openReviewAgain(review)}>Review again</ActionButton>;
	const resume = <ActionButton run={() => handFocus('live', () => lifecycle.continue(review))}>Continue</ActionButton>;

	if (phase === 'failed') {
		return (
			<Notice
				icon={<CircleAlert />}
				tone="danger"
				title={
					failure?.usageLimit ? `${failure.usageLimit.name} is out of usage.` : 'The review stopped before it finished.'
				}
				body={review.summary ?? 'The review server gave no reason.'}
			>
				{failure?.signIn ? (
					<Button variant="outline" onClick={() => navigate('/settings/agent?add=provider')}>
						Add a provider
					</Button>
				) : null}
				{failure?.usageLimit ? (
					<Button variant="outline" onClick={() => navigate(SETTINGS_HREF)}>
						Open settings
					</Button>
				) : null}
				{outdated ? again : resume}
			</Notice>
		);
	}

	if (phase === 'cancelled') {
		return (
			<Notice
				icon={<CircleSlash />}
				tone="neutral"
				title="Review cancelled."
				body={
					total > 0
						? 'What the reviewers found before it stopped is below.'
						: 'Continue picks up where the reviewers stopped.'
				}
			>
				{outdated ? null : resume}
				{again}
			</Notice>
		);
	}

	if (phase === 'passed' && outdated && pull) {
		return (
			<Notice
				icon={<GitCommitHorizontal />}
				tone="neutral"
				title="New commits since this review."
				body={
					<>
						It reviewed <span className="mono">{short(review.headSha)}</span>; the pull request is now at{' '}
						<span className="mono">{short(pull.headSha)}</span>.
					</>
				}
			>
				{again}
			</Notice>
		);
	}

	return null;
}
