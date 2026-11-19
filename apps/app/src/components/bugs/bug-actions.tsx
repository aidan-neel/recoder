'use client';

import { DISMISSAL_REASONS, type DismissalReason } from '@recoder/shared';
import {
	Button,
	CopyButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Tooltip
} from '@recoder/ui';
import {
	ArrowUpRightIcon,
	ChatCircleIcon,
	CheckIcon,
	DotsThreeIcon,
	ThumbsDownIcon,
	ThumbsUpIcon
} from '@phosphor-icons/react';

import type { BugsView, BugView } from '@/lib/bugs/types';
import { replaceAddress } from '@/lib/shell/navigation';
import { errorToast, undoToast } from '@/lib/shell/notify';

/** What each reason for dismissing reads as in the menu, under "Dismiss because". */
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
	/** On the Changes tab: the Review tab's address, so the menu can open the whole finding there. */
	reviewHref?: string;
}

/** Shows why a write did not go through. The view already put the bug back as it was. */
function refused(fallback: string): (error: unknown) => void {
	return (error) => errorToast(error instanceof Error && error.message ? error.message : fallback);
}

/**
 * What a person does with an open finding. Two buttons stand out: posting it to the pull request (the primary
 * action when the forge takes comments) and copying its fix prompt for a coding agent. The rest waits in one menu:
 * asking about it, opening it on the Review tab, accepting it, dismissing it with a reason and saying whether it
 * helped. Posting changes the first button's words in a slot of fixed width, so nothing a person might press moves.
 */
export function BugActions({ bug, view, asking, onAskToggle, reviewHref }: BugActionsProps) {
	const pending = view.pending.has(bug.id);
	const posted = bug.posted;

	/** Accepts the bug and offers the way back. */
	function accept(): void {
		view
			.accept(bug.id)
			.then(
				() => undoToast('Accepted', () => void view.reopen(bug.id).catch(refused('The bug did not reopen.'))),
				refused('The bug was not accepted.')
			);
	}

	/** Dismisses with a reason, which teaches the next review, and offers the way back. */
	function dismiss(reason: DismissalReason): void {
		view
			.dismiss(bug.id, reason)
			.then(
				() => undoToast('Dismissed', () => void view.reopen(bug.id).catch(refused('The bug did not reopen.'))),
				refused('The bug was not dismissed.')
			);
	}

	/** Casts the vote, or takes it back when it is the one already cast. */
	function cast(vote: 'useful' | 'not-useful'): void {
		view.vote(bug.id, bug.vote === vote ? null : vote).catch(refused('The vote was not saved.'));
	}

	return (
		<div className="bug-actions">
			{view.canPost ? (
				<Button
					variant="primary"
					className="bug-post"
					status={pending ? 'pending' : 'idle'}
					onClick={() => view.post(bug.id).catch(refused('The comment was not posted.'))}
				>
					{posted ? 'Update the comment' : 'Post to pull request'}
				</Button>
			) : null}
			<CopyButton
				variant={view.canPost ? 'secondary' : 'primary'}
				value={view.fixPrompt(bug.id)}
				label="Copy fix prompt"
				copiedLabel="Copied"
			/>
			<DropdownMenu>
				<Tooltip content="More actions">
					<DropdownMenuTrigger>
						<Button variant="ghost" size="icon" className="bug-more" aria-label="More actions">
							<DotsThreeIcon weight="bold" aria-hidden />
						</Button>
					</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent align="end" className="w-[220px]">
					<DropdownMenuItem icon={<ChatCircleIcon />} onSelect={onAskToggle}>
						{asking ? 'Close the question' : 'Ask about it'}
					</DropdownMenuItem>
					{reviewHref ? (
						<DropdownMenuItem
							icon={<ArrowUpRightIcon />}
							onSelect={() => replaceAddress(`${reviewHref}#bug-${encodeURIComponent(bug.id)}`)}
						>
							Open in Review
						</DropdownMenuItem>
					) : null}
					{posted ? (
						<DropdownMenuItem
							icon={<ArrowUpRightIcon />}
							onSelect={() => window.open(posted.url, '_blank', 'noreferrer')}
						>
							See the comment
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem icon={<CheckIcon />} disabled={pending} onSelect={accept}>
						Accept
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuLabel>Dismiss because</DropdownMenuLabel>
					{DISMISSAL_REASONS.map((reason) => (
						<DropdownMenuItem key={reason} disabled={pending} onSelect={() => dismiss(reason)}>
							{REASON_LABELS[reason]}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						icon={<ThumbsUpIcon weight={bug.vote === 'useful' ? 'fill' : 'regular'} />}
						onSelect={() => cast('useful')}
					>
						{bug.vote === 'useful' ? 'Take back "useful"' : 'Useful'}
					</DropdownMenuItem>
					<DropdownMenuItem
						icon={<ThumbsDownIcon weight={bug.vote === 'not-useful' ? 'fill' : 'regular'} />}
						onSelect={() => cast('not-useful')}
					>
						{bug.vote === 'not-useful' ? 'Take back "not useful"' : 'Not useful'}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
