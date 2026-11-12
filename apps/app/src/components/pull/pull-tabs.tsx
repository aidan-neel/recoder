'use client';

import { NavPill, NavPillGroup } from '@recoder/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useApi } from '@/lib/api/client';
import { PULL_TABS, type PullPageView, type PullTab } from '@/lib/pull/types';
import { pullHref } from '@/lib/shell/routes';
import { useKeys } from '@/lib/shell/use-keys';

const LABELS: Record<PullTab, string> = {
	changes: 'Changes',
	summary: 'Summary',
	bugs: 'Bugs',
	commits: 'Commits'
};

interface PullTabsProps {
	repoId: string;
	number: number;
	tab: PullTab;
	counts: PullPageView['counts'];
}

/** The number a tab wears: files, open bugs or commits. Summary has none, and a zero is left out. */
function countOf(tab: PullTab, counts: PullPageView['counts']): number | null {
	const value = { changes: counts.files, summary: null, bugs: counts.bugs, commits: counts.commits }[tab];

	return value === 0 ? null : value;
}

/**
 * The page's tabs as links, so each has an address and opens in a new tab
 * like any link. The pill slides to the open one; `1` to `4` switch.
 */
export function PullTabs({ repoId, number, tab, counts }: PullTabsProps) {
	const router = useRouter();
	const { base } = useApi();
	const hrefOf = (target: PullTab) => pullHref(base, repoId, number, target);
	const open = (target: PullTab) => router.replace(hrefOf(target), { scroll: false });

	useKeys({
		'1': () => open('changes'),
		'2': () => open('summary'),
		'3': () => open('bugs'),
		'4': () => open('commits')
	});

	return (
		<NavPillGroup>
			<nav className="pull-tabs" aria-label="Pull request">
				{PULL_TABS.map((id) => {
					const count = countOf(id, counts);

					return (
						<Link
							key={id}
							href={hrefOf(id)}
							replace
							scroll={false}
							className="pull-tab"
							aria-current={id === tab ? 'page' : undefined}
						>
							{id === tab ? <NavPill value={id} /> : null}
							{LABELS[id]}
							{count !== null ? (
								<span className="pull-tab-count" data-tone={id === 'bugs' ? 'bugs' : undefined}>
									{count}
								</span>
							) : null}
						</Link>
					);
				})}
			</nav>
		</NavPillGroup>
	);
}
