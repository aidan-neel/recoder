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
	Pill,
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

/** Why the button is off, for the blocks that keep it on screen. */
const BLOCK_REASONS: Partial<Record<MergeBlock, string>> = {
	draft: 'A draft cannot merge. Mark it ready on the forge first.',
	conflicts: 'Resolve the conflicts with the base branch first.',
	blocked: 'A branch rule, a required check or a missing approval stops this merge.'
};

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
 * since it cannot be taken back from here. A merged or closed pull request
 * shows that in place of the button; where Recoder cannot merge, nothing shows.
 */
export function MergeButton({ view, pull, base }: MergeButtonProps) {
	const [confirming, setConfirming] = useState(false);

	if (view.block === 'merged') return <Pill tone="sent">Merged</Pill>;
	if (view.block === 'closed') return <Pill tone="danger">Closed</Pill>;
	if (view.block === 'unavailable' || !view.method) return null;

	/** The menu hands back the chosen row's value as text; only a method the repository allows is set. */
	function chooseMethod(value: string): void {
		const chosen = view.methods.find((method) => method === value);

		if (chosen) view.setMethod(chosen);
	}

	const label = METHOD_LABELS[view.method].action;
	const reason = view.block ? BLOCK_REASONS[view.block] : undefined;
	const off = view.block !== null || view.phase === 'merging';

	const button = (
		<Button
			variant={view.block ? 'outline' : 'primary'}
			disabled={off}
			status={view.phase === 'merging' ? 'pending' : 'idle'}
			onClick={() => setConfirming(true)}
		>
			{label}
		</Button>
	);

	return (
		<>
			<div className="merge-split">
				{reason ? (
					<Tooltip content={reason} side="top">
						<span tabIndex={0}>{button}</span>
					</Tooltip>
				) : (
					button
				)}
				<DropdownMenu>
					<DropdownMenuTrigger>
						<Button
							variant={view.block ? 'outline' : 'primary'}
							size="icon"
							aria-label="Choose how to merge"
							disabled={view.phase === 'merging'}
						>
							<ChevronDown />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="top" align="end" className="w-[300px]">
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
