'use client';

import { useApi } from '@/lib/api/client';
import { useWarmCommits } from '@/lib/pull/pull-session';
import { PULL_TABS, type PullPageView, type PullTab } from '@/lib/pull/types';
import { useRunView } from '@/lib/run/use-run';
import { replaceSearch } from '@/lib/shell/navigation';
import { pullHref } from '@/lib/shell/routes';
import { useKeys } from '@/lib/shell/use-keys';

import { type PageTab, PageTabs } from '@/components/common/page-tabs';

import { reviewTabMark } from './review-tab-mark';

const LABELS: Record<PullTab, string> = {
	changes: 'Changes',
	summary: 'Summary',
	review: 'Review',
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
	return { changes: counts.files, summary: null, review: counts.bugs, commits: counts.commits }[tab];
}

/**
 * The pull request page's tabs. `1` to `4` switch between them. The Review
 * tab says where the newest review stands, and its open bugs once it is done.
 */
export function PullTabs({ repoId, number, tab, counts }: PullTabsProps) {
	const { base } = useApi();
	const review = reviewTabMark(useRunView());
	const hrefOf = (target: PullTab) => pullHref(base, repoId, number, target);
	const open = (target: PullTab) => replaceSearch(hrefOf(target));
	const warmCommits = useWarmCommits();

	useKeys({
		'1': () => open('changes'),
		'2': () => open('summary'),
		'3': () => open('review'),
		'4': () => open('commits')
	});

	const tabs = PULL_TABS.map((id): PageTab => {
		const marked = id === 'review' && review !== null;

		return {
			id,
			label: LABELS[id],
			href: hrefOf(id),
			count: marked ? null : countOf(id, counts),
			tone: id === 'review' ? 'bugs' : undefined,
			adornment: marked ? review : undefined,
			warm: id === 'commits' ? warmCommits : undefined
		};
	});

	return <PageTabs label="Pull request" tabs={tabs} current={tab} />;
}
