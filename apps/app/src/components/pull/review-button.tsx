'use client';

import { REVIEW_SPEED_PLANS, type ReviewSpeed } from '@recoder/shared';
import { DropdownMenuItem, Keycap, SplitButton } from '@recoder/ui';
import { LightningIcon } from '@phosphor-icons/react';

import { isLive } from '@/lib/run/run-phase';
import type { RunView } from '@/lib/run/types';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';
import { useKeys } from '@/lib/shell/use-keys';

/** The review the split button's menu offers beside the standard one. */
const SPARK = REVIEW_SPEED_PLANS.spark;

/**
 * True when a review is the pull request's next step: none ran, the last was cancelled or failed, or the pull
 * request moved past it. The Review button is then the page's primary and the merge button steps back.
 */
export function reviewIsNext(run: RunView): boolean {
	return run.phase === 'none' || run.phase === 'cancelled' || run.phase === 'failed' || run.outdated;
}

/**
 * The pull request page's one control that starts a review, at the end of the header's title row. It reads
 * Review until a review has run and Review again after; a click (or `r`) starts the standard review, a failed
 * one at the same head continues from where it stopped, and the menu offers Spark, the fast one. While a review
 * is queued, runs or is paused there is none: the Review tab's row holds Pause and Cancel.
 */
export function ReviewButton({ run }: { run: RunView }) {
	const action = useAction();
	const live = isLive(run.phase);
	const again = run.phase === 'passed' || run.phase === 'failed';
	const next = reviewIsNext(run);

	/** Starts the review; a refusal shows the server's reason in a toast and the button offers to try again. */
	function start(speed: ReviewSpeed): void {
		const resume = run.phase === 'failed' && !run.outdated && speed === 'standard';

		action.run(() =>
			(resume ? run.retry() : run.start(speed)).catch((error: unknown) => {
				errorToast(error instanceof Error && error.message ? error.message : 'The review did not start.');
				throw error;
			})
		);
	}

	useKeys(live ? {} : { r: () => start('standard') });

	if (live) return null;

	return (
		<SplitButton
			variant={next ? 'primary' : 'outline'}
			status={run.starting ? 'pending' : action.status}
			onClick={() => start('standard')}
			data-run-primary=""
			menuLabel="Other ways to review"
			menuClassName="w-[300px]"
			menu={
				<DropdownMenuItem icon={<LightningIcon />} className="split-option" onSelect={() => start('spark')}>
					<span className="flex flex-col gap-0.5 whitespace-normal">
						{SPARK.label} review
						<span className="split-option-detail">{SPARK.description}</span>
					</span>
				</DropdownMenuItem>
			}
		>
			{again ? 'Review again' : 'Review'}
			{next ? <Keycap k="r" /> : null}
		</SplitButton>
	);
}
