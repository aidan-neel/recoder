'use client';

import { REVIEW_SPEED_PLANS, type ReviewSpeed } from '@recoder/shared';
import { ConfirmDialog, DropdownMenuItem, Icon, Keycap, Spinner, SplitButton } from '@recoder/ui';
import { useState } from 'react';

import { isLive } from '@/lib/run/run-phase';
import type { RunView } from '@/lib/run/types';
import { rejectWithToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';
import { useKeys } from '@/lib/shell/use-keys';

/** The review the split button's menu offers beside the standard one. */
const SPARK = REVIEW_SPEED_PLANS.spark;

/** What the control offers: start a review, continue a failed one, cancel a live one or resume a paused one. */
type Face = 'review' | 'again' | 'continue' | 'cancel' | 'resume';

const LABELS: Record<Face, string> = {
	review: 'Review',
	again: 'Review again',
	continue: 'Continue review',
	cancel: 'Cancel review',
	resume: 'Resume review'
};

/** The words the button's own pending and done faces show while a cancel goes through. */
const CANCELLING = 'Cancelling';

const CANCELLED = 'Cancelled';

/**
 * True when a review is the pull request's next step: none ran, the last was cancelled or failed, or the pull
 * request moved past it. The Review button is then the page's primary and the merge button steps back.
 */
export function reviewIsNext(run: RunView): boolean {
	return run.phase === 'none' || run.phase === 'cancelled' || run.phase === 'failed' || run.outdated;
}

/** The face for where the review stands; a failed review at the same head continues from where it stopped. */
function faceOf(run: RunView): Face {
	if (run.phase === 'paused') return 'resume';
	if (isLive(run.phase)) return 'cancel';
	if (run.phase === 'failed' && !run.outdated) return 'continue';

	return run.phase === 'passed' || run.phase === 'failed' ? 'again' : 'review';
}

/** A live review's glyph: a spinner at rest, and the stop square of Capy's stop button under the pointer or focus. */
function StopGlyph() {
	return (
		<span className="review-stop" aria-hidden>
			<Spinner size={13} />
			<Icon name="stop" fill className="review-stop-square size-2.5" />
		</span>
	);
}

/** What the button reads for `face`, with the `r` keycap while a review is the next step. */
function FaceLabel({ face, next }: { face: Face; next: boolean }) {
	if (face === 'cancel') {
		return (
			<span>
				<StopGlyph />
				{LABELS.cancel}
			</span>
		);
	}

	if (face === 'resume') {
		return (
			<span>
				<Icon name="play_arrow" fill className="size-3" />
				{LABELS.resume}
			</span>
		);
	}

	return (
		<span>
			{LABELS[face]}
			{next ? <Keycap k="r" /> : null}
		</span>
	);
}

/** Every label the button can show, unseen in its cell, so the button keeps the widest one's width in every state. */
function LabelSizer() {
	return (
		<>
			{(['review', 'again', 'continue'] as const).map((face) => (
				<span key={face} className="review-control-sizer" aria-hidden>
					{LABELS[face]}
					<Keycap k="r" />
				</span>
			))}
			{[LABELS.cancel, LABELS.resume, CANCELLING, CANCELLED].map((label) => (
				<span key={label} className="review-control-sizer" aria-hidden>
					<span className="review-control-glyph" />
					{label}
				</span>
			))}
		</>
	);
}

/**
 * The pull request page's one review control, at the end of the header's title row. It never leaves its place or
 * changes its width; it reads where the review stands. Review (Review again after one ran) starts the standard
 * review on a click or `r`, and its menu offers Spark, the fast one; a failed review at the same head reads
 * Continue review. A queued or running review reads Cancel review, with a spinner that turns into a stop square
 * under the pointer, and its menu pauses it; a paused one reads Resume review, and its menu cancels it. Cancelling
 * a review that has started asks first, because its findings so far are dropped; a queued one has nothing to lose
 * and cancels at once, and the question closes itself if the review ends while it is open. The cancel shows on the
 * button itself: Cancelling, then Cancelled, then Review.
 */
export function ReviewButton({ run }: { run: RunView }) {
	const action = useAction();
	const cancelling = useAction({ showSuccess: true });
	const [asking, setAsking] = useState(false);
	const face = faceOf(run);
	const next = reviewIsNext(run);
	const live = isLive(run.phase);

	if (asking && !live) setAsking(false);

	/** Starts the review; a refusal shows the server's reason in a toast and the button offers to try again. */
	function start(speed: ReviewSpeed): void {
		const resume = face === 'continue' && speed === 'standard';

		action.run(() => (resume ? run.retry() : run.start(speed)).catch(rejectWithToast('The review did not start.')));
	}

	function cancel(): void {
		cancelling.run(() => run.cancel().catch(rejectWithToast('The review was not cancelled.')));
	}

	/** Asks before cancelling a review that has done work; a queued one cancels at once. */
	function askCancel(): void {
		if (run.phase === 'queued') return cancel();

		setAsking(true);
	}

	function press(): void {
		if (face === 'cancel') return askCancel();
		if (face === 'resume') return action.run(() => run.resume().catch(rejectWithToast('The review did not resume.')));

		start('standard');
	}

	useKeys(live ? {} : { r: () => start('standard') });

	const status = run.starting ? 'pending' : cancelling.status === 'idle' ? action.status : cancelling.status;

	return (
		<>
			<SplitButton
				variant={next || face === 'resume' ? 'primary' : 'outline'}
				status={status}
				pendingLabel={cancelling.status === 'idle' ? undefined : CANCELLING}
				successLabel={CANCELLED}
				onClick={press}
				menuLabel={live ? 'Review controls' : 'Other ways to review'}
				menuClassName="w-[300px]"
				menu={live ? <LiveMenu run={run} onPause={action.run} onCancel={askCancel} /> : <SparkItem onStart={start} />}
			>
				<span className="review-control-label">
					<LabelSizer />
					<FaceLabel face={face} next={next} />
				</span>
			</SplitButton>
			<ConfirmDialog
				open={asking}
				onOpenChange={setAsking}
				title="Cancel this review?"
				description="The review stops and the findings so far are dropped. You can start a new one."
				confirmLabel="Cancel review"
				cancelLabel="Keep reviewing"
				destructive
				onConfirm={cancel}
			/>
		</>
	);
}

/** The menu's one row while no review runs: Spark, the fast review, and what it leaves out. */
function SparkItem({ onStart }: { onStart: (speed: ReviewSpeed) => void }) {
	return (
		<DropdownMenuItem icon={<Icon name="bolt" />} className="split-option" onSelect={() => onStart('spark')}>
			<span className="flex flex-col gap-0.5 whitespace-normal">
				{SPARK.label} review
				<span className="split-option-detail">{SPARK.description}</span>
			</span>
		</DropdownMenuItem>
	);
}

interface LiveMenuProps {
	run: RunView;
	/** Runs the pause through the button's action, so the button shows it pending. */
	onPause: (pause: () => Promise<unknown>) => void;
	onCancel: () => void;
}

/** The menu while a review is live: Pause while it runs (offered but shut while it waits its turn), Cancel once paused. */
function LiveMenu({ run, onPause, onCancel }: LiveMenuProps) {
	if (run.phase === 'paused') {
		return (
			<DropdownMenuItem icon={<Icon name="close" />} className="split-option" onSelect={onCancel}>
				<span className="flex flex-col gap-0.5 whitespace-normal">
					Cancel review
					<span className="split-option-detail">Stops the review and drops its findings.</span>
				</span>
			</DropdownMenuItem>
		);
	}

	return (
		<DropdownMenuItem
			icon={<Icon name="pause" />}
			className="split-option"
			disabled={run.phase !== 'running'}
			onSelect={() => onPause(() => run.pause().catch(rejectWithToast('The review did not pause.')))}
		>
			<span className="flex flex-col gap-0.5 whitespace-normal">
				Pause review
				<span className="split-option-detail">
					{run.phase === 'running' ? 'Holds the review until you resume it.' : 'Once the review starts.'}
				</span>
			</span>
		</DropdownMenuItem>
	);
}
