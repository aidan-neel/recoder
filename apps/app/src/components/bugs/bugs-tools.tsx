'use client';

import { REVIEW_SPEED_PLANS } from '@recoder/shared';
import { Button, Icon, Pill, Tooltip } from '@recoder/ui';

import type { BugsView } from '@/lib/bugs/types';
import { shortSha } from '@/lib/files/ref-label';
import { isLive } from '@/lib/run/run-phase';
import type { RunView } from '@/lib/run/types';
import { rejectWithToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { Age } from '@/components/common/age';

import { FyiToggle } from './fyi-toggle';

interface BugsToolsProps {
	view: BugsView;
	run: RunView;
}

/** Where the posted review is on the pull request; plain words when the forge gave no link. */
function PostedReview({ url }: { url: string | null }) {
	if (!url) return <span className="meta">Posted on the pull request</span>;

	return (
		<Button asChild variant="ghost">
			<a href={url} target="_blank" rel="noreferrer">
				See the review
				<Icon name="arrow_outward" className="size-3.5" />
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
			onClick={() => posting.run(() => view.postAll().catch(rejectWithToast('The review was not posted.')))}
		>
			{failed ? 'Post again' : 'Post review'}
		</Button>
	);

	return failed && posted.error ? <Tooltip content={posted.error}>{button}</Tooltip> : button;
}

/** The commit a review read, shortened as every forge shortens it; the full hash on hover. */
function CommitPill({ sha }: { sha: string }) {
	return (
		<Pill face="code" icon={<Icon name="commit" />} title={sha}>
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
				<Pill icon={<Icon name="bolt" />}>{spark.label}</Pill>
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
				<Pill icon={<Icon name="schedule" />}>
					<Age at={view.reviewedAt} form="long" />
				</Pill>
			) : null}
			{view.modelLabel ? <Pill>{view.modelLabel}</Pill> : null}
			{view.speed === 'spark' ? <SparkPill /> : null}
			{view.duration ? <Pill icon={<Icon name="timer" />}>{view.duration}</Pill> : null}
		</span>
	);
}

/**
 * A review in progress, in the tab row: the commit it reads and its model as badges, and a note while the live
 * connection is down. The tab shows how long it has run; pausing and cancelling it is the header's review control.
 */
function RunFacts({ run }: { run: RunView }) {
	return (
		<span className="review-facts" aria-label="This review">
			{run.connection === 'reconnecting' ? <span className="meta">Reconnecting…</span> : null}
			{run.headSha ? <CommitPill sha={run.headSha} /> : null}
			{run.modelLabel ? <Pill>{run.modelLabel}</Pill> : null}
		</span>
	);
}

/**
 * The Review tab's tools in the tab row: the facts of the review being shown and posting it on the pull request.
 * Starting, pausing and cancelling a review is the header's review control. While a review is queued, runs or is
 * paused, its facts take their place.
 */
export function BugsTools({ view, run }: BugsToolsProps) {
	if (isLive(run.phase)) return <RunFacts run={run} />;
	if (view.phase !== 'ready') return null;

	return (
		<>
			<ReviewFacts view={view} />
			<FyiToggle count={view.fyi.length} />
			<PostReview view={view} />
		</>
	);
}
