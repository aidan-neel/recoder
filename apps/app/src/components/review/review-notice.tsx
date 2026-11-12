'use client';

import { Button, Card, CodeBlock, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@recoder/ui';
import { ChevronDown, CircleAlert, CircleSlash, GitCommitHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { OpenConnections } from '@/components/guidelines/open-connections';
import { handFocus, takeFocus } from '@/lib/live/focus-handoff';
import { failureReason } from '@/lib/review/failure-reason';
import { lifecycle } from '@/lib/review/lifecycle';
import { useReview } from '@/lib/review/review-store';
import { SETTINGS_HREF } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

import { ActionButton } from './action-button';
import { forgeName, openReviewAgain, useCounts, useOutdated, usePhase, useShownReview } from './review-view';

interface NoticeProps {
	icon: ReactNode;
	title: string;
	body: ReactNode;
	/** A tool's own output behind the plain reason, folded under Details. */
	details?: string | null;
	tone: 'danger' | 'neutral';
	children: ReactNode;
}

/** The output a plain reason stands for, folded until asked for. */
function Details({ text }: { text: string }) {
	const [open, setOpen] = useState(false);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="review-notice-details">
			<CollapsibleTrigger asChild>
				<Button variant="ghost" className="review-notice-toggle">
					Details
					<ChevronDown data-open={open} className="review-notice-chevron" aria-hidden />
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<CodeBlock code={text} wrap copy className="review-notice-raw" />
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * A review-level notice: why the review is not the last word, and the way
 * forward. When it replaces the live view after a confirmed cancel, its
 * first action takes focus, so focus does not fall to the page.
 */
function Notice({ icon, title, body, details, tone, children }: NoticeProps) {
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
				{details ? <Details text={details} /> : null}
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

/** The pull request on its forge, for a failure no action here can fix. */
function OpenOnForge({ url, forge }: { url: string | null; forge: string | null }) {
	if (!url || !forge) return null;

	return (
		<Button variant="outline" asChild>
			<a href={url} target="_blank" rel="noreferrer">
				Open on {forge}
			</a>
		</Button>
	);
}

/**
 * The notice a finished review may need at the top of its overview: it
 * failed (Continue), it was cancelled (Continue or Review again), or commits
 * landed after it (Review again). A failed review of an old commit is
 * reviewed again rather than continued. A model that ran out of usage is
 * named, with settings one click away to pick another. A failure reads in
 * plain words, with any tool output under Details. A failure that would
 * recur offers no Continue: a rejected token offers Connections alone (the
 * menu's Continue is there once the token is fixed), and a diff over the
 * forge's limit offers the pull request on its forge.
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
		const forge = forgeName(review);
		const reason = failureReason(review.summary);

		return (
			<Notice
				icon={<CircleAlert />}
				tone="danger"
				title={
					failure?.usageLimit ? `${failure.usageLimit.name} is out of usage.` : 'The review stopped before it finished.'
				}
				body={reason.text}
				details={reason.raw}
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
				{reason.next === 'connections' ? <OpenConnections /> : null}
				{reason.next === 'none' ? <OpenOnForge url={pull?.url ?? review.prUrl ?? null} forge={forge} /> : null}
				{reason.next === 'continue' ? (outdated ? again : resume) : null}
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
