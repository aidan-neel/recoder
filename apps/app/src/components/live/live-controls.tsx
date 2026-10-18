'use client';

import type { Review } from '@recoder/shared';
import { Button, ConfirmDialog } from '@recoder/ui';
import { Pause, Play } from 'lucide-react';
import { useState } from 'react';

import { handFocus } from '@/lib/live/focus-handoff';
import type { LivePhase } from '@/lib/live/live-progress';
import { lifecycle } from '@/lib/review/lifecycle';
import { useAction } from '@/lib/shell/use-action';

/** Pause and Resume share one button that keeps its width as its label flips. */
function PauseButton({ review, paused }: { review: Review; paused: boolean }) {
	const { status, run } = useAction();

	return (
		<Button
			variant={paused ? 'primary' : 'outline'}
			status={status}
			className="live-toggle"
			onClick={() => run(() => (paused ? lifecycle.resume(review) : lifecycle.pause(review)))}
		>
			{paused ? <Play aria-hidden /> : <Pause aria-hidden />}
			{paused ? 'Resume' : 'Pause'}
		</Button>
	);
}

function CancelButton({ review }: { review: Review }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button variant="ghost" onClick={() => setOpen(true)}>
				Cancel review
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title="Cancel this review?"
				description="The reviewers stop now. You can continue it later from where it stopped."
				confirmLabel="Cancel review"
				cancelLabel="Keep reviewing"
				destructive
				onConfirm={() => handFocus('notice', () => lifecycle.cancel(review))}
			/>
		</>
	);
}

function StartButton({ review }: { review: Review }) {
	const { status, run } = useAction();

	return (
		<Button
			variant="primary"
			status={status}
			onClick={() => run(() => handFocus('live', () => lifecycle.start(review)))}
		>
			Start review
		</Button>
	);
}

/**
 * What the reader can do while a review has no decisions: start a draft,
 * pause or resume a running review, or cancel it. A queued review has
 * neither, since the server can only stop a review once it runs. Start and
 * a confirmed cancel leave with the view, so each hands focus to the view
 * that replaces it.
 */
export function LiveControls({ review, phase }: { review: Review; phase: LivePhase }) {
	if (phase === 'draft') return <StartButton review={review} />;

	if (phase !== 'running' && phase !== 'paused') return null;

	return (
		<div className="flex items-center gap-2">
			<CancelButton review={review} />
			<PauseButton review={review} paused={phase === 'paused'} />
		</div>
	);
}
