'use client';

import type { PullDescription, PullDescriptionState, PullPage } from '@recoder/shared';
import { Button, Skeleton, StatusNotice } from '@recoder/ui';
import { useMemo, useState, type ReactNode } from 'react';

import type { BugView } from '@/lib/bugs/types';
import { useBugsView, useSummaryView } from '@/lib/bugs/use-bugs';
import { useGuide } from '@/lib/changes/use-changes';
import {
	usePullConversationView,
	usePullDescriptionView,
	usePullDiffView,
	usePullPageView
} from '@/lib/pull/pull-session';
import type { PullDescriptionView } from '@/lib/pull/types';
import { useRunView } from '@/lib/run/use-run';
import { groupViews } from '@/lib/summary/change-groups';
import { LOADING_DESCRIPTION } from '@/lib/summary/loading-summary';
import { useProseSources } from '@/lib/summary/use-prose-sources';
import { useReviewArriving } from '@/lib/summary/use-review-arriving';

import { ChangeGroups } from './change-groups';
import { Conversation } from './conversation';
import { DescriptionLede } from './description-lede';
import { DescriptionRail } from './description-rail';
import { Overview } from './overview';
import { ProseRefsContext } from './prose';
import { Walkthrough } from './walkthrough';

interface DescriptionTabProps {
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
	/** Opens the Changes tab at a changed file. */
	onOpenFile: (path: string) => void;
	/** Opens the Changes tab at a finding, under its line. */
	onOpenFinding: (bug: BugView) => void;
	onOpenReview: () => void;
}

interface DescribedProps extends DescriptionTabProps {
	description: PullDescription;
	phase: 'loading' | 'writing' | 'ready';
	/** True while no description is in hand and `description` is a stand-in for the skeletons to measure. */
	standIn: boolean;
	awaits: (markdown: string | null) => boolean;
	onRedescribe: () => void;
	conversation: ReactNode;
}

interface UndescribedProps {
	notice: ReactNode;
	awaits: (markdown: string | null) => boolean;
	onOpenGuide: () => void;
	conversation: ReactNode;
}

/** The forge origin (`https://github.com`, a self-hosted GitLab host) from the pull request's URL, or null locally. */
function forgeOriginOf(page: PullPage | null): string | null {
	if (!page || page.provider === 'local' || !page.pull.url) return null;

	try {
		const parsed = new URL(page.pull.url);

		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
	} catch {
		return null;
	}
}

/**
 * The Description tab: what the change does as a model wrote it, then the change in groups to read in order, each
 * with its files and findings, and the pull request's conversation; every open finding and the notes stand beside it.
 * Without a description, it is the review's account and the walkthrough of its plan. The prose names the pull
 * request's files and commits as badges, so text that could gain one waits for the diff or the commits.
 */
export function DescriptionTab({ onOpenGuide, onOpenFile, onOpenFinding, onOpenReview }: DescriptionTabProps) {
	const page = usePullPageView().page;
	const view = usePullDescriptionView();
	const conversationView = usePullConversationView();
	const { sources, awaits } = useProseSources();
	const forgeOrigin = forgeOriginOf(page);
	const refs = useMemo(() => ({ sources, openFile: onOpenFile, forgeOrigin }), [sources, onOpenFile, forgeOrigin]);
	const state = view.state.phase === 'ready' ? view.state.value : null;
	const phase = describedPhase(view, state);
	const ready = state?.status === 'ready' ? state.description : null;
	const [kept, setKept] = useState<PullDescription | null>(ready);

	if (ready && ready !== kept) setKept(ready);

	const shown = ready ?? (phase ? kept : null);

	const conversation = (
		<Conversation view={conversationView} waiting={conversationView.entries.some((entry) => awaits(entry.body))} />
	);

	return (
		<ProseRefsContext value={refs}>
			<div className="summary">
				<div className="reading">
					<div className="page-column description-layout">
						{phase ? (
							<Described
								description={shown ?? LOADING_DESCRIPTION}
								phase={phase}
								standIn={!shown}
								awaits={awaits}
								onRedescribe={view.redescribe}
								onOpenGuide={onOpenGuide}
								onOpenFile={onOpenFile}
								onOpenFinding={onOpenFinding}
								onOpenReview={onOpenReview}
								conversation={conversation}
							/>
						) : (
							<Undescribed
								notice={<DescriptionNotice view={view} state={state} />}
								awaits={awaits}
								onOpenGuide={onOpenGuide}
								conversation={conversation}
							/>
						)}
					</div>
				</div>
			</div>
		</ProseRefsContext>
	);
}

/** How far the description is, or null when there is none to show: it failed, or the server offers none. */
function describedPhase(view: PullDescriptionView, state: PullDescriptionState | null): DescribedProps['phase'] | null {
	if (view.state.phase === 'loading') return 'loading';
	if (state?.status === 'pending') return 'writing';
	if (state?.status === 'ready') return 'ready';

	return null;
}

/**
 * The description's reading with the findings and notes beside it. While it is written again, the last one stays in
 * place under a line that says so, so nothing moves until the new one lands.
 */
function Described({
	description,
	phase,
	standIn,
	awaits,
	onRedescribe,
	onOpenGuide,
	onOpenFile,
	onOpenFinding,
	onOpenReview,
	conversation
}: DescribedProps) {
	const bugs = useBugsView();
	const diff = usePullDiffView();
	const summary = useSummaryView();
	const by = usePullPageView().page?.pull.author ?? null;
	const files = diff.phase === 'ready' ? diff.value.files : null;
	const groups = useMemo(() => groupViews(description.groups, files, bugs.open), [description, files, bugs.open]);

	return (
		<>
			<div className="summary-column">
				<DescriptionLede
					description={description}
					phase={phase}
					standIn={standIn || awaits(description.summary)}
					author={summary.description ? { text: summary.description, by } : null}
					onRedescribe={onRedescribe}
				/>
				<Skeleton id="description-groups" loading={standIn}>
					<ChangeGroups
						groups={groups}
						onOpenGuide={onOpenGuide}
						onOpenFile={onOpenFile}
						onOpenFinding={onOpenFinding}
					/>
				</Skeleton>
				{conversation}
			</div>
			<DescriptionRail
				bugs={bugs}
				notes={description.notes}
				standIn={standIn}
				onOpenFinding={onOpenFinding}
				onOpenReview={onOpenReview}
			/>
		</>
	);
}

/** Without a description: the review's account and the walkthrough of its plan, under why there is no description. */
function Undescribed({ notice, awaits, onOpenGuide, conversation }: UndescribedProps) {
	const summary = useSummaryView();
	const guide = useGuide();
	const run = useRunView();
	const bugs = useBugsView();
	const arriving = useReviewArriving();
	const page = usePullPageView();
	const awaitingBadges = [summary.analysis, summary.description].some(awaits);

	return (
		<div className="summary-column">
			{notice}
			<Overview
				summary={summary}
				run={run}
				bugs={bugs}
				by={page.page?.pull.author ?? null}
				loading={arriving || page.phase === 'loading' || awaitingBadges}
			/>
			<Walkthrough parts={guide} onOpenGuide={onOpenGuide} />
			{conversation}
		</div>
	);
}

/** Why the description is missing when something went wrong, with the way to try again; nothing when none is offered. */
function DescriptionNotice({ view, state }: { view: PullDescriptionView; state: PullDescriptionState | null }) {
	if (view.state.phase === 'failed') {
		const { retry } = view.state;

		return (
			<StatusNotice
				tone="danger"
				title="The description did not load."
				detail={view.state.error}
				actions={
					<Button variant="outline" onClick={retry}>
						Try again
					</Button>
				}
			/>
		);
	}

	if (state?.status !== 'failed') return null;

	return (
		<StatusNotice
			tone="danger"
			title="The description could not be written."
			detail={state.error}
			actions={
				<Button variant="outline" onClick={view.redescribe}>
					Write it again
				</Button>
			}
		/>
	);
}
