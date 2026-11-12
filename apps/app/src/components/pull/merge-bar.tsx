'use client';

import type { PullMergeability, PullPage } from '@recoder/shared';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import Link from 'next/link';

import { useApi } from '@/lib/api/client';
import type { MergeView, PullChecksView } from '@/lib/pull/types';
import { plural } from '@/lib/shell/format';
import { pullHref } from '@/lib/shell/routes';

import { ChecksPopover } from './checks-popover';
import { MergeButton } from './merge-button';

interface Fact {
	tone: 'ok' | 'bad' | 'wait';
	text: string;
}

const FACT_ICONS = { ok: CircleCheck, bad: CircleX, wait: CircleDashed };

/** What the forge says about merging into `base`; nothing while it has not worked it out. */
function mergeFact(mergeability: PullMergeability, base: string): Fact | null {
	if (mergeability === 'clean') return { tone: 'ok', text: `No conflicts with ${base}` };
	if (mergeability === 'conflicts') return { tone: 'bad', text: `Conflicts with ${base}` };
	if (mergeability === 'blocked') return { tone: 'wait', text: 'Blocked by a branch rule' };

	return null;
}

interface MergeBarProps {
	page: PullPage;
	checks: PullChecksView;
	merge: MergeView;
	/** Open findings of the newest review; null before a review. */
	bugs: number | null;
}

/**
 * The foot of the page: can this merge? The checks, the conflicts and the
 * open bugs on the left, each one fact; the merge button on the right. A
 * merged or closed pull request keeps the bar for its facts.
 */
export function MergeBar({ page, checks, merge, bugs }: MergeBarProps) {
	const { base } = useApi();
	const open = page.status.state === 'open';
	const fact = open ? mergeFact(page.status.mergeability, page.pull.base) : null;
	const FactIcon = fact ? FACT_ICONS[fact.tone] : null;

	return (
		<footer className="merge-bar">
			<ChecksPopover view={checks} />
			{fact && FactIcon ? (
				<span className="merge-bar-fact" data-tone={fact.tone}>
					<FactIcon aria-hidden />
					{fact.text}
				</span>
			) : null}
			{open && bugs ? (
				<Link
					href={pullHref(base, page.repoId, page.pull.number, 'bugs')}
					replace
					scroll={false}
					className="merge-bar-fact text-link"
					data-tone="bad"
				>
					<CircleX aria-hidden />
					{plural(bugs, 'open bug')}
				</Link>
			) : null}
			<div className="merge-bar-end">
				{merge.phase === 'failed' && merge.error ? (
					<span className="merge-error" role="alert" title={merge.error}>
						{merge.error}
					</span>
				) : null}
				<MergeButton view={merge} pull={`#${page.pull.number}`} base={page.pull.base} />
			</div>
		</footer>
	);
}
