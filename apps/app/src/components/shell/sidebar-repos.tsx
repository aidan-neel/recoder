'use client';

import { useCallback } from 'react';

import { useApi, useOverviewCache } from '@/lib/api/client';
import { navigate, usePathname } from '@/lib/shell/navigation';
import { addRepoHref } from '@/lib/shell/routes';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { SidebarRepo } from '@/lib/shell/types';

import { RecentCard } from './recent-row';
import { RepoTile } from './repo-tile';
import { SidebarSection } from './sidebar-section';

/**
 * The tracked repositories, each a row that opens its page: the forge's mark, the name, then its open pull requests
 * and, in red, the high-severity bugs open across them. The open one sits on the same still fill as a review. With
 * none tracked, the section is left out. Its title folds it away, its + adds a repository and its ⋯ hides it.
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
			<nav aria-label="Repositories" className="recent-list">
				{repos.map((repo) => (
					<RepoItem key={repo.id} repo={repo} active={pathname === repo.href} />
				))}
			</nav>
		</SidebarSection>
	);
}

/** One repository: resting on it reads its overview, so its page opens filled. */
function RepoItem({ repo, active }: { repo: SidebarRepo; active: boolean }) {
	const overviews = useOverviewCache();
	const warm = useCallback(() => overviews.warm(repo.id), [overviews, repo.id]);

	return (
		<RecentCard
			href={repo.href}
			active={active}
			tile={<RepoTile forge={repo.provider} />}
			title={repo.name}
			onIntent={warm}
			foot={
				<span className="recent-foot-text">
					{repo.open} open
					{repo.highBugs > 0 ? (
						<span className="recent-alert">
							{' · '}
							{repo.highBugs} high {repo.highBugs === 1 ? 'bug' : 'bugs'}
						</span>
					) : null}
				</span>
			}
		/>
	);
}
