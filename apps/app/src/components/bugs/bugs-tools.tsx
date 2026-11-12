'use client';

import { Button, Tooltip } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';

import type { BugsView } from '@/lib/bugs/types';
import type { RunView } from '@/lib/run/types';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { Age } from '@/components/common/age';

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
				<ArrowUpRight aria-hidden className="size-3.5" />
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
	const posted = view.findingsReview;

	if (posted?.state === 'posted') return <PostedReview url={posted.url} />;
	if (!view.canPost) return null;

	const failed = posted?.state === 'failed';

	const button = (
		<Button
			variant="outline"
			status={view.postingAll || posted?.state === 'posting' ? 'pending' : 'idle'}
			onClick={() => view.postAll().catch(report('The review was not posted.'))}
		>
			{failed ? 'Post again' : 'Post review'}
		</Button>
	);

	return failed && posted.error ? <Tooltip content={posted.error}>{button}</Tooltip> : button;
}

/**
 * The Bugs tab's tools in the tab row: the facts of the review being shown
 * (when, at which commit, with which model, how long it took), posting it on
 * the pull request, and reviewing again.
 */
export function BugsTools({ view, run }: BugsToolsProps) {
	const reviewing = useAction();
	const busy = run.phase === 'queued' || run.phase === 'running';

	if (view.phase !== 'ready') return null;

	return (
		<>
			<span className="meta">
				Reviewed <Age at={view.reviewedAt} form="long" />
				{view.headSha ? (
					<>
						{' at '}
						<span className="mono">{view.headSha.slice(0, 7)}</span>
					</>
				) : null}
				{view.modelLabel ? <span className="meta-sep">{view.modelLabel}</span> : null}
				{view.duration ? <span className="meta-sep">{view.duration}</span> : null}
			</span>
			<PostReview view={view} />
			{!busy ? (
				<Button
					variant="outline"
					status={run.starting ? 'pending' : reviewing.status}
					onClick={() => reviewing.run(() => run.start().catch(report('The review did not start.')))}
				>
					Review again
				</Button>
			) : null}
		</>
	);
}
