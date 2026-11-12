'use client';

import { HoverList, NavPill, NavPillGroup, RowButton } from '@recoder/ui';
import { BookOpen, Clock, GitPullRequest, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';

import { useApi } from '@/lib/api/client';
import { AUTOMATIONS_HREF, GUIDELINES_HREF, newReviewHref, pullsHref } from '@/lib/shell/routes';

type Place = 'new' | 'pulls' | 'automations' | 'guidelines';

interface NavRow {
	id: Place;
	label: string;
	href: string;
	icon: ComponentType<{ className?: string }>;
}

/** The place the address belongs to, or null on a page the sidebar does not list (Settings). */
function placeOf(pathname: string, base: string): Place | null {
	const path = pathname.slice(base.length) || '/';

	if (path === '/' || path.startsWith('/pulls')) return 'pulls';
	if (path.startsWith('/new')) return 'new';
	if (pathname.startsWith(AUTOMATIONS_HREF)) return 'automations';
	if (pathname.startsWith(GUIDELINES_HREF)) return 'guidelines';

	return null;
}

/** The four places. The pill slides to the one on screen; the count beside Pull requests is the open ones. */
export function SidebarNav({ openPulls }: { openPulls: number | null }) {
	const { base } = useApi();
	const active = placeOf(usePathname(), base);

	const rows: NavRow[] = [
		{ id: 'new', label: 'New review', href: newReviewHref(base), icon: Plus },
		{ id: 'pulls', label: 'Pull requests', href: pullsHref(base), icon: GitPullRequest },
		{ id: 'automations', label: 'Automations', href: AUTOMATIONS_HREF, icon: Clock },
		{ id: 'guidelines', label: 'Guidelines', href: GUIDELINES_HREF, icon: BookOpen }
	];

	return (
		<nav aria-label="Main">
			<NavPillGroup>
				<HoverList className="sidebar-nav" itemSelector="[data-nav]">
					{rows.map(({ id, label, href, icon: Icon }) => (
						<RowButton key={id} asChild data-nav data-active={active === id || undefined} className="nav-item">
							<Link href={href} aria-current={active === id ? 'page' : undefined}>
								{active === id ? <NavPill value={id} /> : null}
								<Icon aria-hidden />
								{label}
								{id === 'pulls' && openPulls !== null ? (
									<span className="nav-count" aria-label={`${openPulls} open`}>
										{openPulls}
									</span>
								) : null}
							</Link>
						</RowButton>
					))}
				</HoverList>
			</NavPillGroup>
		</nav>
	);
}
