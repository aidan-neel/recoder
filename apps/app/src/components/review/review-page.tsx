'use client';

import { Button, preloadHighlighter } from '@recoder/ui';
import { StatusNotice } from '@recoder/ui/status-notice';
import Link from 'next/link';
import { useEffect, useLayoutEffect } from 'react';

import { DecisionAnnouncer } from '@/components/decision/decision-announcer';
import { HandoffModal } from '@/components/decision/handoff-modal';
import { OFFLINE_DETAIL, OFFLINE_TEXT } from '@/lib/api/http';
import type { ReadFailure } from '@/lib/review/review-read';
import { keepShapeOf } from '@/lib/review/review-shapes';
import { selectionKey, useReview } from '@/lib/review/review-store';
import { warmOpenTabs } from '@/lib/review/review-warm';
import { useAction } from '@/lib/shell/use-action';

import { AskColumn } from './ask-column';
import { PanelBoundary } from './panel-boundary';
import { ReadingPane } from './reading-pane';
import { focusReadingPane } from './reading-viewport';
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

/** True when the review came in but the page could not show it, a fault that a retry would hit again. */
function brokeInPage(failure: ReadFailure | null): boolean {
	return failure?.kind === 'other';
}

/** What failed, said once; the reason after it, when there is one, says why. */
const NOT_LOADED_TEXT = 'The review didn’t load.';

/**
 * The notice's sentences for each way a load fails, picked by the failure's
 * kind: one for what failed, and a second only when it adds something, such
 * as the server's own reason. None tells the person to try again, since the
 * Try again button beside it does.
 */
function unavailableText(
	status: 'missing' | 'offline' | 'failed',
	failure: ReadFailure | null
): [string, string | null] {
	if (status === 'missing')
		return ['This review doesn’t exist.', 'It may have been deleted, or the link is from another machine.'];
	if (status === 'offline') return [OFFLINE_TEXT, OFFLINE_DETAIL];
	if (failure?.kind === 'timeout') return [failure.text, null];
	if (failure && !brokeInPage(failure)) return [NOT_LOADED_TEXT, failure.text || null];

	return [failure?.text || NOT_LOADED_TEXT, 'Reloading the page may fix it.'];
}

function reloadPage(): void {
	window.location.reload();
}

/**
 * The review could not load: it is gone, the server is not running, the load
 * failed, or the page could not show what came back. Try again loads it
 * again; a review the page broke on offers Reload instead, since a retry
 * would break the same way.
 */
function ReviewUnavailable({ status }: { status: 'missing' | 'offline' | 'failed' }) {
	const failure = useReview((state) => state.loadError);
	const [lead, rest] = unavailableText(status, failure);
	const broke = status === 'failed' && brokeInPage(failure);

	return (
		<StatusNotice
			variant="page"
			title={lead}
			detail={rest}
			actions={
				<>
					{broke ? <Button onClick={reloadPage}>Reload</Button> : null}
					{status === 'missing' || broke ? null : <TryAgain />}
					<Button variant="outline" asChild>
						<Link href="/">Back to the queue</Link>
					</Button>
				</>
			}
		/>
	);
}

/**
 * Moves focus into the review as it first shows, when nothing holds it (a
 * click on a queue row or a tab leaves it on the page), so keys and Tab start
 * in the reading pane. The pane takes it quietly, with no ring for a pointer.
 * The focus moves on the next animation frame, to keep its layout cost out of
 * the commit: focusing needs the page's layout, and asking in the commit that
 * first draws the review forced a layout of the whole page there (about 50ms
 * at 4x CPU).
 */
function useArrivalFocus(): void {
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const active = document.activeElement;

			if (!active || active === document.body) focusReadingPane();
		});

		return () => cancelAnimationFrame(frame);
	}, []);
}

/** The reading pane's boundary clears when the selection changes, so moving to another item renders again. */
function PaneBoundary() {
	const key = useReview((state) => selectionKey(state.selection));

	return (
		<PanelBoundary name="The reading pane" className="review-main" resetKey={key}>
			<ReadingPane />
		</PanelBoundary>
	);
}

/**
 * The loaded review: header, rail, reading pane and the ask column, with the
 * page's keys. Each panel keeps its own render errors, so one that breaks
 * says so in place and the rest of the page keeps working.
 */
function ReviewReady() {
	useReviewKeys();
	useArrivalFocus();

	return (
		<div data-ui="review-page" className="review-page">
			<ReviewSync />
			<ReviewHeader />
			<div className="review-body">
				<PanelBoundary name="The rail" className="rail">
					<ReviewRail />
				</PanelBoundary>
				<PaneBoundary />
				<PanelBoundary name="Ask" className="ask-column ask-column-failed">
					<AskColumn />
				</PanelBoundary>
			</div>
			<HandoffModal />
			<DecisionAnnouncer />
		</div>
	);
}

/**
 * One review: the rail, the reading pane and the decision bar. The load runs
 * before the first paint, so a review this tab showed before paints at once
 * from its last copy; a first visit shows the skeleton until the review and
 * its diff are in. Once ready, the other open tabs are read ahead, and the
 * review's shape is kept for the next skeleton that stands for it.
 */
export function ReviewPage({ id }: { id: string }) {
	const status = useReview((state) => (state.id === id ? state.status : 'loading'));
	const ready = status === 'ready';

	useLayoutEffect(() => {
		preloadHighlighter();

		return useReview.getState().load(id, linkedItem());
	}, [id]);

	useEffect(() => (ready ? warmOpenTabs(id) : undefined), [ready, id]);
	useEffect(() => (ready ? keepShapeOf(id) : undefined), [ready, id]);

	if (status === 'loading') return <ReviewSkeleton id={id} />;
	if (status !== 'ready') return <ReviewUnavailable status={status} />;

	return <ReviewReady />;
}
