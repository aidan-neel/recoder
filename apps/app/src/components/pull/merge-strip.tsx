'use client';

import type { PullMergeability, PullPage } from '@recoder/shared';
import { Collapsible } from '@recoder/ui';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import Link from 'next/link';

import { useApi } from '@/lib/api/client';
import type { MergeView, PullChecksView } from '@/lib/pull/types';
import { plural } from '@/lib/shell/format';
import { pullHref } from '@/lib/shell/routes';

import { ChecksList, ChecksToggle } from './checks';
import { MergeButton } from './merge-button';
import { PullMenu } from './pull-menu';

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

/** The hairline between two facts of the strip. */
function Divider() {
	return <span aria-hidden className="merge-strip-divider" />;
}

interface MergeStripProps {
	page: PullPage;
	checks: PullChecksView;
	merge: MergeView;
	/** Open findings of the newest review; null before a review. */
	bugs: number | null;
}

/**
 * Can this merge? One strip under the title: the checks (which open into
 * their list), the conflicts and the open bugs on the left, each one fact;
 * the pull request's menu and the merge button on the right. A merged or
 * closed pull request keeps the strip for its facts.
 */
export function MergeStrip({ page, checks, merge, bugs }: MergeStripProps) {
	const { base } = useApi();
	const open = page.status.state === 'open';
	const fact = open ? mergeFact(page.status.mergeability, page.pull.base) : null;
	const FactIcon = fact ? FACT_ICONS[fact.tone] : null;

	return (
		<Collapsible className="merge-strip">
			<div className="merge-strip-row">
				<ChecksToggle view={checks} />
				{fact && FactIcon ? (
					<>
						<Divider />
						<span className="merge-fact" data-tone={fact.tone}>
							<FactIcon aria-hidden />
							{fact.text}
						</span>
					</>
				) : null}
				{open && bugs ? (
					<>
						<Divider />
						<Link
							href={pullHref(base, page.repoId, page.pull.number, 'bugs')}
							replace
							scroll={false}
							className="merge-fact text-link"
							data-tone="bad"
						>
							<CircleX aria-hidden />
							{plural(bugs, 'open bug')}
						</Link>
					</>
				) : null}
				<div className="merge-strip-end">
					{merge.phase === 'failed' && merge.error ? (
						<span className="merge-error" role="alert" title={merge.error}>
							{merge.error}
						</span>
					) : null}
					<PullMenu page={page} />
					<MergeButton view={merge} pull={`#${page.pull.number}`} base={page.pull.base} />
				</div>
			</div>
			<ChecksList view={checks} />
		</Collapsible>
	);
}
