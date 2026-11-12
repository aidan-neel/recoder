'use client';

import { StatusNotice } from '@recoder/ui/status-notice';

import { OpenConnections } from '@/components/guidelines/open-connections';
import type { ReadFailure } from '@/lib/review/review-read';
import { useReview, type ReviewStore } from '@/lib/review/review-store';

import { ActionButton } from './action-button';

/** The parts of a review read beside it, each with its own failure and retry. */
type Part = 'files' | 'checks' | 'pull';

/** What failed, worded as the review page's own notice words it ("The review didn’t load."). */
const TITLE: Record<Part, string> = {
	files: 'The diff didn’t load.',
	checks: 'The checks didn’t load.',
	pull: 'The pull request didn’t load.'
};

/** The pull request line's title when a rejected token kept the checks out too. */
const PULL_AND_CHECKS = 'The pull request and its checks didn’t load.';

const RETRY: Record<Part, (state: ReviewStore) => () => Promise<void>> = {
	files: (state) => state.retryFiles,
	checks: (state) => state.retryChecks,
	pull: (state) => state.retryPull
};

/**
 * Why a part failed, as the page shows it. CI checks come from the same
 * forge with the same token as the pull request, so a checks failure waits
 * for the pull request's lookup, and while that line says the token was
 * rejected, it names the checks too and the checks say nothing more.
 */
export function shownFailure(state: ReviewStore, part: Part): ReadFailure | null {
	if (part === 'files') return state.filesError;
	if (part === 'pull') return state.pullError;

	return !state.pullAnswered || state.pullError?.kind === 'auth' ? null : state.checksError;
}

/** What failed, in one sentence. */
function titleOf(state: ReviewStore, part: Part): string {
	return part === 'pull' && state.pullError?.kind === 'auth' && state.checksError ? PULL_AND_CHECKS : TITLE[part];
}

/**
 * One quiet line where a part of the review would be, when reading it
 * failed: what failed, the reason in plain words when there is one, and the
 * way out. Try again reads that part alone again and keeps a spinner until
 * the server answers; a rejected token opens Connections instead, since a
 * retry would fail the same way. Renders nothing while the part is fine.
 */
export function ReadFailed({ part, className }: { part: Part; className?: string }) {
	const failure = useReview((state) => shownFailure(state, part));
	const title = useReview((state) => titleOf(state, part));
	const retry = useReview(RETRY[part]);

	if (!failure) return null;

	return (
		<StatusNotice
			variant="inline"
			tone="danger"
			title={title}
			detail={failure.text || null}
			actions={failure.kind === 'auth' ? <OpenConnections /> : <ActionButton run={retry}>Try again</ActionButton>}
			className={className}
		/>
	);
}
