'use client';

import { REVIEW_SPEED_PLANS } from '@recoder/shared';
import { Button, Pill, Tooltip } from '@recoder/ui';
import { ArrowUpRightIcon, ClockIcon, GitCommitIcon, TimerIcon, LightningIcon } from '@phosphor-icons/react';

import type { BugsView } from '@/lib/bugs/types';
import { shortSha } from '@/lib/files/ref-label';
import { isLive } from '@/lib/run/run-phase';
import type { RunView } from '@/lib/run/types';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { Age } from '@/components/common/age';
import { CancelReviewButton } from '@/components/common/cancel-review';
import { ReviewButton } from '@/components/pull/run-banner';

interface BugsToolsProps {
	view: BugsView;
	run: RunView;
}

/** Shows why an action did not go through, and keeps the rejection so the button shows it failed. */
function report(fallback: string): (error: unknown) => never {
	return (error) => {
		errorToast(error instanceof Error && error.message ? error.message : fallback);
		throw error;
	};
}

/** Where the posted review is on the pull request; plain words when the forge gave no link. */
function PostedReview({ url }: { url: string | null }) {
	if (!url) return <span className="meta">Posted on the pull request</span>;

	return (
		<Button asChild variant="ghost">
			<a href={url} target="_blank" rel="noreferrer">
				See the review
				<ArrowUpRightIcon aria-hidden className="size-3.5" />
			</a>
		</Button>
	);
}

/**
 * Puts the review on the pull request as one forge review: its summary, the
 * bugs on their lines and the commit check. Once it is up, the button gives
 * way to a link to it; a failed attempt keeps the button, with the forge's
 * reason on hover.
 */
function PostReview({ view }: { view: BugsView }) {
	const posting = useAction();
	const posted = view.findingsReview;

	if (posted?.state === 'posted') return <PostedReview url={posted.url} />;
	if (!view.canPost) return null;

	const failed = posted?.state === 'failed';

	const button = (
		<Button
			variant="outline"
			status={view.postingAll || posted?.state === 'posting' ? 'pending' : posting.status}
			onClick={() => posting.run(() => view.postAll().catch(report('The review was not posted.')))}
		>
			{failed ? 'Post again' : 'Post review'}
		</Button>
	);

	return failed && posted.error ? <Tooltip content={posted.error}>{button}</Tooltip> : button;
}

/** The commit a review read, shortened as every forge shortens it; the full hash on hover. */
function CommitPill({ sha }: { sha: string }) {
	return (
		<Pill face="code" icon={<GitCommitIcon aria-hidden />} title={sha}>
			{shortSha(sha)}
		</Pill>
	);
}

/** Says a review was Spark, the fast one, so a person knows why it found less; what Spark leaves out on hover. */
function SparkPill() {
	const spark = REVIEW_SPEED_PLANS.spark;

	return (
		<Tooltip content={spark.description}>
			<span tabIndex={0} className="flex">
				<Pill icon={<LightningIcon aria-hidden />}>{spark.label}</Pill>
			</span>
		</Tooltip>
	);
}

/**
 * The facts of the review being shown, as badges: the commit it read, when it ran, its model, whether it was Spark,
 * and how long it took.
 */
function ReviewFacts({ view }: { view: BugsView }) {
	return (
		<span className="review-facts" aria-label="This review">
			{view.headSha ? <CommitPill sha={view.headSha} /> : null}
			{view.reviewedAt ? (
				<Pill icon={<ClockIcon aria-hidden />}>
					<Age at={view.reviewedAt} form="long" />
				</Pill>
			) : null}
			{view.modelLabel ? <Pill>{view.modelLabel}</Pill> : null}
			{view.speed === 'spark' ? <SparkPill /> : null}
			{view.duration ? <Pill icon={<TimerIcon aria-hidden />}>{view.duration}</Pill> : null}
		</span>
	);
}

/**
 * A review in progress, in the tab row: the commit it reads and its model as
 * badges, then Pause (Resume once paused) and Cancel. The tab already shows
 * how long it has run.
 */
function RunTools({ run }: { run: RunView }) {
	const control = useAction();
	const paused = run.phase === 'paused';

	return (
		<>
			<span className="review-facts" aria-label="This review">
				{run.connection === 'reconnecting' ? <span className="meta">Reconnecting…</span> : null}
				{run.headSha ? <CommitPill sha={run.headSha} /> : null}
				{run.modelLabel ? <Pill>{run.modelLabel}</Pill> : null}
			</span>
			{paused ? (
				<Button
					variant="primary"
					status={control.status}
					onClick={() => control.run(() => run.resume().catch(report('The review did not resume.')))}
				>
					Resume
				</Button>
			) : run.phase === 'running' ? (
				<Button
					variant="ghost"
					status={control.status}
					onClick={() => control.run(() => run.pause().catch(report('The review did not pause.')))}
				>
					Pause
				</Button>
			) : null}
			<CancelReviewButton variant="outline" />
		</>
	);
}

/**
 * The Review tab's tools in the tab row: the facts of the review being shown,
 * posting it on the pull request, and reviewing again. Reviewing again stays
 * when the findings did not load, so a done review can always run once more.
 * While a review is queued, runs or is paused, its own tools take their place.
 */
export function BugsTools({ view, run }: BugsToolsProps) {
	if (isLive(run.phase)) return <RunTools run={run} />;
	if (view.phase !== 'ready' && view.phase !== 'failed') return null;

	return (
		<>
			{view.phase === 'ready' ? (
				<>
					<ReviewFacts view={view} />
					<PostReview view={view} />
				</>
			) : null}
			<ReviewButton run={run} again />
		</>
	);
}
