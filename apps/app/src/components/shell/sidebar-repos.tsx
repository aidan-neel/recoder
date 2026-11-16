'use client';

import { ForgeMark, HoverList, RowButton } from '@recoder/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { SidebarRepo } from '@/lib/shell/types';

import { SidebarSection } from './sidebar-section';

/**
 * The tracked repositories, each opening its page, on the same lanes as the places above: the forge's mark, the name,
 * and a red dot at the end while one of its open pull requests has an open high-severity bug. The open one sits on the
 * same still fill. With none tracked, the section is left out. Its title folds it away.
 */
export function SidebarRepos({ repos }: { repos: SidebarRepo[] }) {
	const pathname = usePathname();
	const open = useSidebarFolds((state) => !state.folded.includes('repos'));
	const setOpen = useSidebarFolds((state) => state.setOpen);

	if (repos.length === 0) return null;

	return (
		<SidebarSection
			title="Repositories"
			open={open}
			onOpenChange={(next) => setOpen('repos', next)}
			className="sidebar-repos"
		>
			<nav aria-label="Repositories">
				<HoverList className="sidebar-nav" itemSelector="[data-nav]">
					{repos.map((repo) => {
						const active = pathname === repo.href;

						return (
							<RowButton key={repo.id} asChild data-nav data-active={active || undefined} className="nav-item">
								<Link href={repo.href} aria-current={active ? 'page' : undefined}>
									<ForgeMark provider={repo.provider} className="nav-forge" />
									<span className="nav-label">{repo.name}</span>
									{repo.alert ? <span className="nav-alert" role="img" aria-label="Has high-severity bugs" /> : null}
								</Link>
							</RowButton>
						);
					})}
				</HoverList>
			</nav>
		</SidebarSection>
	);
}
