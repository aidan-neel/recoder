'use client';

import { HoverList, RowButton } from '@recoder/ui';
import { BookMarked } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { SidebarRepo } from '@/lib/shell/types';

import { SidebarSection } from './sidebar-section';

/**
 * The tracked repositories, each opening its page, on the same lanes as the places above. The open one sits on the
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
								<Link href={repo.href} prefetch aria-current={active ? 'page' : undefined}>
									<BookMarked aria-hidden />
									<span className="nav-label">{repo.name}</span>
								</Link>
							</RowButton>
						);
					})}
				</HoverList>
			</nav>
		</SidebarSection>
	);
}
