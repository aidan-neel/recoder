'use client';

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	RowButton
} from '@recoder/ui';
import { ArrowUpRight, Ellipsis, Link2, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { memo, useCallback } from 'react';

import type { PullRow as PullRowView } from '@/lib/pulls/types';
import { copyLink } from '@/lib/shell/copy-link';
import { author } from '@/lib/shell/format';
import { useIntent } from '@/lib/shell/intent';

import { Age } from '@/components/common/age';
import { DiffStat } from '@/components/common/diff-stat';
import { PullMark } from '@/components/common/pull-mark';
import { RepoLabel } from '@/components/common/repo-label';

import { PullStatus } from './pull-status';

interface PullRowProps {
	row: PullRowView;
	starting: boolean;
	onReview: (row: PullRowView) => void;
	/** Runs once the pointer or focus has rested on the row: prefetching its page. */
	onIntent?: (row: PullRowView) => void;
}

/** True when the row's menu should offer a review: it has one already, so the row itself shows a state. */
function canReviewAgain(row: PullRowView): boolean {
	return row.reviewId !== null && row.status.kind !== 'reviewing' && row.status.kind !== 'outdated';
}

/** What the row's menu does: review again, open beside this tab, copy the link. */
function RowMenu({ row, onReview }: Pick<PullRowProps, 'row' | 'onReview'>) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button variant="ghost" size="icon" aria-label={`More for #${row.number}`}>
					<Ellipsis />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{canReviewAgain(row) ? (
					<DropdownMenuItem icon={<RotateCw />} onSelect={() => onReview(row)}>
						Review again
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem icon={<ArrowUpRight />} onSelect={() => window.open(row.href, '_blank', 'noopener')}>
					Open in a new tab
				</DropdownMenuItem>
				<DropdownMenuItem icon={<Link2 />} onSelect={() => copyLink(new URL(row.href, location.origin).href)}>
					Copy link
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * One open pull request: the whole row opens it, and the status and the menu
 * stay clickable above that. It re-renders only when its own row changes.
 */
export const PullRow = memo(function PullRow({ row, starting, onReview, onIntent }: PullRowProps) {
	const by = author(row.author);
	const intent = useIntent(useCallback(() => onIntent?.(row), [onIntent, row]));

	return (
		<li className="pull-row" data-pull-row={row.key} {...intent}>
			<PullMark state={row.status.kind === 'draft' ? 'draft' : 'open'} />
			<div className="pull-row-text">
				<div className="pull-row-title">
					<RowButton asChild cover>
						<Link href={row.href} data-row-link>
							{row.title}
						</Link>
					</RowButton>
					<span className="pull-row-number">#{row.number}</span>
				</div>
				<div className="meta pull-row-meta">
					{by.name}
					<RepoLabel className="meta-sep" name={row.repoName} forge={row.repoForge} />
					<Age at={row.activeAt} className="meta-sep" />
				</div>
			</div>
			<div className="pull-row-status">
				<PullStatus status={row.status} starting={starting} onReview={() => onReview(row)} />
			</div>
			<DiffStat additions={row.additions} deletions={row.deletions} />
			<div className="pull-row-menu">
				<RowMenu row={row} onReview={onReview} />
			</div>
		</li>
	);
});
