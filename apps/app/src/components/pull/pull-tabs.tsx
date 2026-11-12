'use client';

import { useRouter } from 'next/navigation';

import { useApi } from '@/lib/api/client';
import { PULL_TABS, type PullPageView, type PullTab } from '@/lib/pull/types';
import { pullHref } from '@/lib/shell/routes';
import { useKeys } from '@/lib/shell/use-keys';

import { type PageTab, PageTabs } from '@/components/common/page-tabs';

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

/** The number a tab wears: files, open bugs or commits. Summary has none. */
function countOf(tab: PullTab, counts: PullPageView['counts']): number | null {
	return { changes: counts.files, summary: null, bugs: counts.bugs, commits: counts.commits }[tab];
}

/** The pull request page's tabs. `1` to `4` switch between them. */
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

	const tabs = PULL_TABS.map((id): PageTab => ({
		id,
		label: LABELS[id],
		href: hrefOf(id),
		count: countOf(id, counts),
		tone: id === 'bugs' ? 'bugs' : undefined
	}));

	return <PageTabs label="Pull request" tabs={tabs} current={tab} />;
}
