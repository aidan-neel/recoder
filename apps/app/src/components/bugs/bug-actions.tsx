'use client';

import { DISMISSAL_REASONS, type DismissalReason } from '@recoder/shared';
import {
	Button,
	CopyButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip
} from '@recoder/ui';
import { ArrowUpRight, ChevronDown, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react';

import type { BugsView, BugView } from '@/lib/bugs/types';
import { errorToast, undoToast } from '@/lib/shell/notify';

/** What each reason for dismissing reads as in the menu. */
const REASON_LABELS: Record<DismissalReason, string> = {
	wrong: 'It is wrong',
	'not-worth-fixing': 'Not worth fixing',
	'already-handled': 'Already handled',
	'style-preference': 'A style preference',
	duplicate: 'A duplicate'
};

interface BugActionsProps {
	bug: BugView;
	view: BugsView;
	asking: boolean;
	onAskToggle: () => void;
}

/** Shows why a write did not go through. The view already put the bug back as it was. */
function refused(fallback: string): (error: unknown) => void {
	return (error) => errorToast(error instanceof Error && error.message ? error.message : fallback);
}

/** The reasons to dismiss a bug. The choice teaches the next review; Undo opens the bug again. */
function DismissMenu({ bug, view }: Pick<BugActionsProps, 'bug' | 'view'>) {
	/** Dismisses with a reason and offers the way back. */
	function dismiss(reason: DismissalReason): void {
		view
			.dismiss(bug.id, reason)
			.then(
				() => undoToast('Dismissed', () => void view.reopen(bug.id).catch(refused('The bug did not reopen.'))),
				refused('The bug was not dismissed.')
			);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button variant="ghost">
					Dismiss
					<ChevronDown aria-hidden className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-[200px]">
				{DISMISSAL_REASONS.map((reason) => (
					<DropdownMenuItem key={reason} onSelect={() => dismiss(reason)}>
						{REASON_LABELS[reason]}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Whether the bug helped: one of two votes, pressed again to take it back. */
function Votes({ bug, view }: Pick<BugActionsProps, 'bug' | 'view'>) {
	/** Casts the vote, or takes it back when it is the one already cast. */
	function cast(vote: 'useful' | 'not-useful'): void {
		view.vote(bug.id, bug.vote === vote ? null : vote).catch(refused('The vote was not saved.'));
	}

	return (
		<div className="bug-actions-end">
			<span>Was this useful?</span>
			<Tooltip content="Useful">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Useful"
					aria-pressed={bug.vote === 'useful'}
					onClick={() => cast('useful')}
				>
					<ThumbsUp />
				</Button>
			</Tooltip>
			<Tooltip content="Not useful">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Not useful"
					aria-pressed={bug.vote === 'not-useful'}
					onClick={() => cast('not-useful')}
				>
					<ThumbsDown />
				</Button>
			</Tooltip>
		</div>
	);
}

/**
 * What a person does with an open bug: post it to the pull request (the
 * primary action when the forge takes comments), hand its fix prompt to a
 * coding agent, ask about it, accept it or dismiss it, and say whether it
 * helped.
 */
export function BugActions({ bug, view, asking, onAskToggle }: BugActionsProps) {
	const pending = view.pending.has(bug.id);

	return (
		<div className="bug-actions">
			{view.canPost ? (
				<Button
					variant={bug.posted ? 'outline' : 'primary'}
					status={pending ? 'pending' : 'idle'}
					onClick={() => view.post(bug.id).catch(refused('The comment was not posted.'))}
				>
					{bug.posted ? 'Update the comment' : 'Post to pull request'}
				</Button>
			) : null}
			{bug.posted ? (
				<Button asChild variant="ghost">
					<a href={bug.posted.url} target="_blank" rel="noreferrer">
						See the comment
						<ArrowUpRight aria-hidden className="size-3.5" />
					</a>
				</Button>
			) : null}
			<CopyButton
				variant={view.canPost ? 'outline' : 'primary'}
				value={view.fixPrompt(bug.id)}
				label="Copy fix prompt"
				copiedLabel="Copied"
			/>
			<Button variant="ghost" aria-expanded={asking} onClick={onAskToggle}>
				<MessageCircle aria-hidden />
				Ask
			</Button>
			<Button
				variant="ghost"
				disabled={pending}
				onClick={() => view.accept(bug.id).catch(refused('The bug was not accepted.'))}
			>
				Accept
			</Button>
			<DismissMenu bug={bug} view={view} />
			<Votes bug={bug} view={view} />
		</div>
	);
}
