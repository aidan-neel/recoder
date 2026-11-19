'use client';

import { useBugsView, useSummaryView } from '@/lib/bugs/use-bugs';
import { useMemo } from 'react';

import { useGuide } from '@/lib/changes/use-changes';
import { usePullConversationView, usePullPageView } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { useProseSources } from '@/lib/summary/use-prose-sources';
import { useReviewArriving } from '@/lib/summary/use-review-arriving';

import { Conversation } from './conversation';
import { Overview } from './overview';
import { ProseRefsContext } from './prose';
import { Walkthrough } from './walkthrough';

interface SummaryTabProps {
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
	/** Opens the Changes tab at a changed file. */
	onOpenFile: (path: string) => void;
}

/**
 * The Summary tab: one reading across the page's width. It opens on what the
 * change does (the review's account, its open findings, the author's
 * description), then the order to read it in, then the pull request's own
 * conversation. Where the review stands lives in the header's badge. Until
 * the page and the review's record arrive, the overview holds its skeleton.
 * The prose names the pull request's files and commits as badges, so text
 * that could gain one also waits for the diff or the commits and paints
 * once, badges in place.
 */
export function SummaryTab({ onOpenGuide, onOpenFile }: SummaryTabProps) {
	const summary = useSummaryView();
	const guide = useGuide();
	const conversation = usePullConversationView();
	const run = useRunView();
	const bugs = useBugsView();
	const arriving = useReviewArriving();
	const page = usePullPageView();
	const by = page.page?.pull.author ?? null;
	const { sources, awaits } = useProseSources();
	const refs = useMemo(() => ({ sources, openFile: onOpenFile }), [sources, onOpenFile]);
	const awaitingBadges = [summary.analysis, summary.description].some(awaits);

	return (
		<ProseRefsContext value={refs}>
			<div className="summary">
				<div className="reading">
					<div className="summary-column">
						<Overview
							summary={summary}
							run={run}
							bugs={bugs}
							by={by}
							loading={arriving || page.phase === 'loading' || awaitingBadges}
						/>
						<Walkthrough parts={guide} open={bugs.open} onOpenGuide={onOpenGuide} />
						<Conversation view={conversation} waiting={conversation.entries.some((entry) => awaits(entry.body))} />
					</div>
				</div>
			</div>
		</ProseRefsContext>
	);
}
