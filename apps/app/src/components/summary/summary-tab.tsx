'use client';

import { useBugsView, useSummaryView } from '@/lib/bugs/use-bugs';
import { useGuide } from '@/lib/changes/use-changes';
import { usePullConversationView, usePullPageView, useSessionData } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { useReviewArriving } from '@/lib/summary/use-review-arriving';

import { AskPane } from '@/components/ask/ask-pane';
import { FilePanelHost } from '@/components/files/file-panel-host';
import { RunBanner } from '@/components/pull/run-banner';

import { Conversation } from './conversation';
import { Overview } from './overview';
import { Walkthrough } from './walkthrough';

interface SummaryTabProps {
	repoId: string;
	number: number;
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
}

/**
 * The Summary tab: the reading on the left, the conversation with Recoder in
 * a pane on the right. The reading opens on what the change does (the
 * review's account, its open findings, the author's description), then the
 * order to read it in, then the pull request's own conversation. The review's
 * banner leads it while a review runs, failed, or is out of date; once a
 * current review passed, the overview says the same and the banner steps aside.
 * Until the review's record arrives, neither speaks: the overview holds its
 * skeleton.
 */
export function SummaryTab({ repoId, number, onOpenGuide }: SummaryTabProps) {
	const summary = useSummaryView();
	const guide = useGuide();
	const conversation = usePullConversationView();
	const run = useRunView();
	const bugs = useBugsView();
	const arriving = useReviewArriving();
	const by = usePullPageView().page?.pull.author ?? null;
	const settled = run.phase === 'passed' && !run.outdated;
	const gitRef = useSessionData((data) => data.review?.headSha ?? data.page.value?.pull.headSha);

	return (
		<FilePanelHost repoId={repoId} gitRef={gitRef}>
			<div className="summary">
				<div className="reading">
					<div className="summary-column">
						{settled || arriving ? null : (
							<RunBanner
								run={run}
								repoId={repoId}
								number={number}
								bugs={bugs.phase === 'ready' ? bugs.open.length : null}
							/>
						)}
						<Overview summary={summary} run={run} bugs={bugs} by={by} loading={arriving} />
						<Walkthrough parts={guide} open={bugs.open} onOpenGuide={onOpenGuide} />
						<Conversation view={conversation} />
					</div>
				</div>
				<AskPane />
			</div>
		</FilePanelHost>
	);
}
