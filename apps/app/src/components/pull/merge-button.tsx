'use client';

import type { PullMergeMethod } from '@recoder/shared';
import {
	Button,
	ConfirmDialog,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
	Tooltip
} from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import type { MergeBlock, MergeView } from '@/lib/pull/types';

const METHOD_LABELS: Record<PullMergeMethod, { action: string; detail: string }> = {
	squash: { action: 'Squash and merge', detail: 'One commit on the base branch.' },
	merge: { action: 'Create a merge commit', detail: 'Every commit, joined by a merge commit.' },
	rebase: { action: 'Rebase and merge', detail: 'Every commit, replayed on the base branch.' }
};

/** Why the pull request cannot merge, for the blocks that show a button that cannot be pressed. */
const BLOCK_REASONS: Partial<Record<MergeBlock, string>> = {
	draft: 'A draft cannot merge. Mark it ready on the forge first.',
	conflicts: 'Resolve the conflicts with the base branch first.',
	blocked: 'A branch rule, a required check or a missing approval stops this merge.'
};

/** The button's words while the forge works out whether the pull request can merge. */
const CHECKING_LABEL = 'Checking';

/** The button's words when the pull request cannot merge; the reason shows on hover. */
const BLOCKED_LABEL = "Can't merge";

interface MergeButtonProps {
	view: MergeView;
	/** `#158`, for the question the confirm dialog asks. */
	pull: string;
	/** The base branch the merge lands on. */
	base: string;
}

/**
 * Merges the pull request: the button names the chosen method, the menu
 * beside it changes the method, and a dialog asks once before the merge,
 * since it cannot be taken back from here. The method shows only when the
 * merge can happen now: while the forge works it out the button says so, and
 * a pull request that cannot merge shows "Can't merge" with the reason on
 * hover. A merged or closed pull request, whose state the title's badges
 * already name, and one Recoder cannot merge at all show nothing.
 */
export function MergeButton({ view, pull, base }: MergeButtonProps) {
	const [confirming, setConfirming] = useState(false);

	if (view.block === 'merged' || view.block === 'closed' || view.block === 'unavailable' || !view.method) return null;

	if (view.block === 'unknown') {
		return (
			<Button variant="outline" disabled status="pending">
				{CHECKING_LABEL}
			</Button>
		);
	}

	if (view.block) {
		return (
			<Tooltip content={BLOCK_REASONS[view.block]} side="bottom">
				<span tabIndex={0}>
					<Button variant="outline" disabled>
						{BLOCKED_LABEL}
					</Button>
				</span>
			</Tooltip>
		);
	}

	/** The menu hands back the chosen row's value as text; only a method the repository allows is set. */
	function chooseMethod(value: string): void {
		const chosen = view.methods.find((method) => method === value);

		if (chosen) view.setMethod(chosen);
	}

	const label = METHOD_LABELS[view.method].action;

	return (
		<>
			<div className="merge-split">
				<Button
					variant="primary"
					className="merge-split-main"
					disabled={view.phase === 'merging'}
					status={view.phase === 'merging' ? 'pending' : 'idle'}
					onClick={() => setConfirming(true)}
				>
					{label}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger>
						<Button
							variant="primary"
							size="icon"
							className="merge-split-menu"
							aria-label="Choose how to merge"
							disabled={view.phase === 'merging'}
						>
							<ChevronDown />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-[300px]">
						<DropdownMenuRadioGroup value={view.method} onValueChange={chooseMethod}>
							{view.methods.map((method) => (
								<DropdownMenuRadioItem key={method} value={method} className="merge-method">
									<span className="flex flex-col gap-0.5">
										{METHOD_LABELS[method].action}
										<span className="merge-method-detail">{METHOD_LABELS[method].detail}</span>
									</span>
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={`Merge ${pull} into ${base}?`}
				description={`${METHOD_LABELS[view.method].detail} This cannot be undone from Recoder.`}
				confirmLabel={label}
				onConfirm={view.merge}
			/>
		</>
	);
}
