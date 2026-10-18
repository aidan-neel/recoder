'use client';

import {
	Button,
	ConfirmDialog,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Spinner
} from '@recoder/ui';
import { ChartNoAxesColumn, Ellipsis, Pause, Play, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { DeleteReviewDialog, type DeleteTarget } from '@/components/queue/delete-review-dialog';
import { lifecycle } from '@/lib/review/lifecycle';

import { isWorking, openReviewAgain, useOutdated, usePhase, useShownReview } from './review-view';
import { TokenUsage } from './token-usage';

type Pending = 'pause' | 'resume' | 'continue' | 'again' | 'start';

interface Action {
	key: Pending;
	label: string;
	icon: ReactNode;
	run: () => Promise<unknown>;
}

/** The lifecycle actions a review in this phase offers, in menu order. */
function useActions(): Action[] {
	const review = useShownReview();
	const phase = usePhase();
	const outdated = useOutdated();
	const actions: Action[] = [];

	if (phase === 'running') {
		actions.push({ key: 'pause', label: 'Pause', icon: <Pause />, run: () => lifecycle.pause(review) });
	}

	if (phase === 'paused') {
		actions.push({ key: 'resume', label: 'Resume', icon: <Play />, run: () => lifecycle.resume(review) });
	}

	if (phase === 'draft') {
		actions.push({ key: 'start', label: 'Start review', icon: <Play />, run: () => lifecycle.start(review) });
	}

	if ((phase === 'failed' || phase === 'cancelled') && !outdated) {
		actions.push({ key: 'continue', label: 'Continue', icon: <RotateCcw />, run: () => lifecycle.continue(review) });
	}

	if (phase === 'passed' || phase === 'cancelled' || (outdated && !isWorking(phase))) {
		actions.push({
			key: 'again',
			label: 'Review again',
			icon: <RefreshCw />,
			run: () => openReviewAgain(review)
		});
	}

	return actions;
}

/**
 * The review's "more" menu: pause or resume, cancel, continue, review again,
 * start, token usage and delete, as the review's phase allows. An action
 * keeps the menu open with a spinner in its row until the server answers;
 * cancel and delete ask first. Only a running or paused review can be
 * cancelled: the server stops a review once it runs, so a queued one is
 * deleted instead.
 */
export function ReviewMenu() {
	const review = useShownReview();
	const phase = usePhase();
	const actions = useActions();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState<Pending | null>(null);
	const [dialog, setDialog] = useState<'cancel' | 'usage' | null>(null);
	const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
	const running = phase === 'running' || phase === 'paused';
	const active = running || phase === 'queued';

	/** Runs an action from its row, holding the menu open while it is pending. */
	function choose(action: Action) {
		return (event: Event) => {
			event.preventDefault();

			if (pending) return;

			setPending(action.key);

			action
				.run()
				.catch(() => {})
				.finally(() => {
					setPending(null);
					setOpen(false);
				});
		};
	}

	return (
		<>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger>
					<Button variant="ghost" size="icon" aria-label="More review actions">
						<Ellipsis />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{actions.map((action) => (
						<DropdownMenuItem
							key={action.key}
							icon={pending === action.key ? <Spinner size={14} /> : action.icon}
							disabled={pending !== null && pending !== action.key}
							onSelect={choose(action)}
						>
							{action.label}
						</DropdownMenuItem>
					))}
					{running ? (
						<DropdownMenuItem icon={<Square />} disabled={pending !== null} onSelect={() => setDialog('cancel')}>
							Cancel review
						</DropdownMenuItem>
					) : null}
					{actions.length > 0 || running ? <DropdownMenuSeparator /> : null}
					<DropdownMenuItem
						icon={<ChartNoAxesColumn />}
						disabled={pending !== null}
						onSelect={() => setDialog('usage')}
					>
						Token usage
					</DropdownMenuItem>
					<DropdownMenuItem
						icon={<Trash2 />}
						destructive
						disabled={pending !== null}
						onSelect={() => setDeleting({ id: review.id, running: active })}
					>
						Delete review
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={dialog === 'cancel'}
				onOpenChange={(next) => setDialog(next ? 'cancel' : null)}
				title="Cancel this review?"
				description="The reviewers stop now. You can continue it later from where it stopped."
				confirmLabel="Cancel review"
				cancelLabel="Keep reviewing"
				destructive
				onConfirm={() => lifecycle.cancel(review)}
			/>
			<DeleteReviewDialog target={deleting} onClose={() => setDeleting(null)} remove={() => lifecycle.remove(review)} />
			<TokenUsage open={dialog === 'usage'} onOpenChange={(next) => setDialog(next ? 'usage' : null)} />
		</>
	);
}
