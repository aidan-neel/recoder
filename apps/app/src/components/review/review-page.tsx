'use client';

import { Button } from '@recoder/ui';
import Link from 'next/link';
import { useEffect } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { DecisionAnnouncer } from '@/components/decision/decision-announcer';
import { HandoffModal } from '@/components/decision/handoff-modal';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useReview } from '@/lib/review/review-store';
import { plainError } from '@/lib/api/server-error';
import { useAction } from '@/lib/shell/use-action';

import { AskColumn } from './ask-column';
import { ReadingPane } from './reading-pane';
import { ReviewHeader } from './review-header';
import { ReviewRail } from './review-rail';
import { ReviewSkeleton } from './review-skeleton';
import { ReviewSync } from './review-sync';
import { useReviewKeys } from './use-review-keys';

/** The item a link opens (`?item=`), read once as the review loads. */
function linkedItem(): string | null {
	return new URLSearchParams(window.location.search).get('item');
}

/** Loads the review again; a load that still fails rejects, so the button shows its failure face. */
async function reload(): Promise<void> {
	await useReview.getState().retry();

	if (useReview.getState().status !== 'ready') throw new Error('The review did not load.');
}

/**
 * Loads the review again, keeping the notice and a spinner in the button until
 * the server answers. A load that works replaces the notice.
 */
function TryAgain() {
	const retry = useAction();

	return (
		<Button status={retry.status} onClick={() => retry.run(reload)}>
			Try again
		</Button>
	);
}

/** The notice's sentence for each way a load fails. A failure with no server message broke in the page itself. */
function unavailableText(status: 'missing' | 'offline' | 'failed', error: string | null): [string, string] {
	if (status === 'missing')
		return ['This review doesn’t exist.', 'It may have been deleted, or the link is from another machine.'];
	if (status === 'offline') return [OFFLINE_TEXT, 'Start it, then try again.'];
	if (error) return ['The review server returned an error.', plainError(error)];

	return ['The review didn’t load.', 'Try again in a moment.'];
}

/** The review could not load: it is gone, the server is not running, or the load failed. */
function ReviewUnavailable({ status }: { status: 'missing' | 'offline' | 'failed' }) {
	const error = useReview((state) => state.loadError);
	const [lead, rest] = unavailableText(status, error);

	return (
		<PageNotice lead={lead} rest={rest}>
			{status === 'missing' ? null : <TryAgain />}
			<Button variant="outline" asChild>
				<Link href="/">Back to the queue</Link>
			</Button>
		</PageNotice>
	);
}

/** The loaded review: header, rail, reading pane and the ask column, with the page's keys. */
function ReviewReady() {
	useReviewKeys();

	return (
		<div data-ui="review-page" className="review-page">
			<ReviewSync />
			<ReviewHeader />
			<div className="review-body">
				<ReviewRail />
				<ReadingPane />
				<AskColumn />
			</div>
			<HandoffModal />
			<DecisionAnnouncer />
		</div>
	);
}

/** One review: the rail, the reading pane and the decision bar. */
export function ReviewPage({ id }: { id: string }) {
	const status = useReview((state) => (state.id === id ? state.status : 'loading'));

	useEffect(() => useReview.getState().load(id, linkedItem()), [id]);

	if (status === 'loading') return <ReviewSkeleton />;
	if (status !== 'ready') return <ReviewUnavailable status={status} />;

	return <ReviewReady />;
}
