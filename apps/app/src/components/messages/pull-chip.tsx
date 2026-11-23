'use client';

import type { PullAttachment } from '@recoder/shared';
import { Button, Tooltip } from '@recoder/ui';
import { XIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useStore } from 'zustand';

import { useApi, useListStore } from '@/lib/api/client';
import { shortRepoName } from '@/lib/pulls/pull-rows';
import { useRowEntries } from '@/lib/pulls/use-rows';
import { pullHref } from '@/lib/shell/routes';

import { Link } from '@/components/common/link';
import { PullMark } from '@/components/common/pull-mark';

/** The attached pull request's title while it is open in the list, and where it lives either way. */
function usePullFace({ repoId, number }: PullAttachment): { title: string | null; ref: string } {
	const entries = useRowEntries();
	const repos = useStore(useListStore().state, (state) => state.repos);

	return useMemo(() => {
		const row = entries.find((entry) => entry.row.repoId === repoId && entry.row.number === number)?.row;

		return { title: row?.title ?? null, ref: `${shortRepoName(repos, repoId)} #${number}` };
	}, [entries, repos, repoId, number]);
}

interface PullChipProps {
	attachment: PullAttachment;
	/** Takes it off a message that is still being written. */
	onRemove?: () => void;
}

/**
 * A pull request attached to a message, as a chip that opens it: its title while it is open, and its repository and
 * number. It is a reference, so it always shows the pull request as it is now, not as it was when sent.
 */
export function PullChip({ attachment, onRemove }: PullChipProps) {
	const { base } = useApi();
	const face = usePullFace(attachment);
	const label = face.title ?? face.ref;

	return (
		<span className="pull-chip">
			<Link href={pullHref(base, attachment.repoId, attachment.number)} className="pull-chip-link">
				<PullMark state="open" />
				<span className="pull-chip-title">{label}</span>
				{face.title ? <span className="pull-chip-ref">{face.ref}</span> : null}
			</Link>
			{onRemove ? (
				<Tooltip content="Remove">
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Remove ${label}`}
						className="pull-chip-remove"
						onClick={onRemove}
					>
						<XIcon />
					</Button>
				</Tooltip>
			) : null}
		</span>
	);
}
