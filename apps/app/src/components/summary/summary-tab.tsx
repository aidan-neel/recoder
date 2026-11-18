'use client';

import { useBugsView, useSummaryView } from '@/lib/bugs/use-bugs';
import { useGuide } from '@/lib/changes/use-changes';
import { usePullConversationView, usePullPageView } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { useReviewArriving } from '@/lib/summary/use-review-arriving';

import { Conversation } from './conversation';
import { Overview } from './overview';
import { Walkthrough } from './walkthrough';

interface SummaryTabProps {
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
}

/**
 * The Summary tab: one reading across the page's width. It opens on what the
 * change does (the review's account, its open findings, the author's
 * description), then the order to read it in, then the pull request's own
 * conversation. Where the review stands lives in the header's badge. Until
 * the page and the review's record arrive, the overview holds its skeleton.
 */
export function SummaryTab({ onOpenGuide }: SummaryTabProps) {
	const summary = useSummaryView();
	const guide = useGuide();
	const conversation = usePullConversationView();
	const run = useRunView();
	const bugs = useBugsView();
	const arriving = useReviewArriving();
	const page = usePullPageView();
	const by = page.page?.pull.author ?? null;

	return (
		<div className="summary">
			<div className="reading">
				<div className="summary-column">
					<Overview summary={summary} run={run} bugs={bugs} by={by} loading={arriving || page.phase === 'loading'} />
					<Walkthrough parts={guide} open={bugs.open} onOpenGuide={onOpenGuide} />
					<Conversation view={conversation} />
				</div>
			</div>
		</div>
	);
}
