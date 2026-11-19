'use client';

import { ForgeMark, HoverList, RowButton } from '@recoder/ui';
import { useCallback } from 'react';

import { useApi, useOverviewCache } from '@/lib/api/client';
import { useIntent } from '@/lib/shell/intent';
import { navigate, usePathname } from '@/lib/shell/navigation';
import { addRepoHref } from '@/lib/shell/routes';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { SidebarRepo } from '@/lib/shell/types';

import { Link } from '@/components/common/link';

import { SidebarSection } from './sidebar-section';

/**
 * The tracked repositories, each opening its page, on the same lanes as the places above: the forge's mark, the name,
 * and a red dot at the end while one of its open pull requests has an open high-severity bug. The open one sits on the
 * same still fill. With none tracked, the section is left out. Its title folds it away, its + adds a repository and
 * its ⋯ hides it.
 */
export function SidebarRepos({ repos }: { repos: SidebarRepo[] }) {
	const { base } = useApi();
	const pathname = usePathname();
	const open = useSidebarFolds((state) => !state.folded.includes('repos'));
	const setOpen = useSidebarFolds((state) => state.setOpen);
	const setShown = useSidebarFolds((state) => state.setShown);

	if (repos.length === 0) return null;

	return (
		<SidebarSection
			title="Repositories"
			open={open}
			onOpenChange={(next) => setOpen('repos', next)}
			className="recent sidebar-repos"
			add={{ label: 'Add repository', onSelect: () => navigate(addRepoHref(base)) }}
			onHide={() => setShown('repos', false)}
		>
			<nav aria-label="Repositories">
				<HoverList className="sidebar-nav" itemSelector="[data-nav]">
					{repos.map((repo) => (
						<RepoItem key={repo.id} repo={repo} active={pathname === repo.href} />
					))}
				</HoverList>
			</nav>
		</SidebarSection>
	);
}

/** One repository: resting on it reads its overview, so its page opens filled. */
function RepoItem({ repo, active }: { repo: SidebarRepo; active: boolean }) {
	const overviews = useOverviewCache();
	const intent = useIntent(useCallback(() => overviews.warm(repo.id), [overviews, repo.id]));

	return (
		<RowButton asChild data-nav data-active={active || undefined} className="nav-item">
			<Link href={repo.href} aria-current={active ? 'page' : undefined} {...intent}>
				<ForgeMark provider={repo.provider} className="nav-forge" />
				<span className="nav-label">{repo.name}</span>
				{repo.highBugs > 0 ? <span className="nav-alert" role="img" aria-label="Has high-severity bugs" /> : null}
			</Link>
		</RowButton>
	);
}
