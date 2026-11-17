'use client';

import { HoverList, RowButton } from '@recoder/ui';
import { BookOpen, Clock, FolderGit2, GitPullRequest, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';

import { useApi } from '@/lib/api/client';
import { useIntent } from '@/lib/shell/intent';
import { AUTOMATIONS_HREF, GUIDELINES_HREF, newReviewHref, pullsHref, reposHref } from '@/lib/shell/routes';

type Place = 'new' | 'pulls' | 'repos' | 'automations' | 'guidelines';

interface NavRow {
	id: Place;
	label: string;
	href: string;
	icon: ComponentType<{ className?: string }>;
}

/**
 * What a place reads first, started once the pointer rests on its row so the
 * page opens filled rather than on its skeleton. The stores load on demand:
 * the route's prefetch has already fetched their code.
 */
const WARM: Partial<Record<Place, () => void>> = {
	automations: () => void import('@/lib/settings/use-auto-review-section').then((module) => module.loadAutomations()),
	guidelines: () =>
		void import('@/lib/guidelines/guidelines-store').then((module) => module.useGuidelines.getState().load())
};

/** The place the address belongs to, or null on a page the sidebar does not list (Settings). */
function placeOf(pathname: string, base: string): Place | null {
	const path = pathname.slice(base.length) || '/';

	if (path === '/' || path.startsWith('/pulls')) return 'pulls';
	if (path.startsWith('/new')) return 'new';
	if (path === '/repos') return 'repos';
	if (pathname.startsWith(AUTOMATIONS_HREF)) return 'automations';
	if (pathname.startsWith(GUIDELINES_HREF)) return 'guidelines';

	return null;
}

/** The places. The one on screen sits on a still fill; the count beside Pull requests is the open ones. */
export function SidebarNav({ openPulls }: { openPulls: number | null }) {
	const { base } = useApi();
	const active = placeOf(usePathname(), base);

	const rows: NavRow[] = [
		{ id: 'new', label: 'New review', href: newReviewHref(base), icon: Plus },
		{ id: 'pulls', label: 'Pull requests', href: pullsHref(base), icon: GitPullRequest },
		{ id: 'repos', label: 'Repositories', href: reposHref(base), icon: FolderGit2 },
		{ id: 'automations', label: 'Automations', href: AUTOMATIONS_HREF, icon: Clock },
		{ id: 'guidelines', label: 'Guidelines', href: GUIDELINES_HREF, icon: BookOpen }
	];

	return (
		<nav aria-label="Main">
			<HoverList className="sidebar-nav" itemSelector="[data-nav]">
				{rows.map((row) => (
					<NavItem key={row.id} row={row} active={active === row.id} openPulls={openPulls} />
				))}
			</HoverList>
		</nav>
	);
}

/** One place: the whole row is its link, and resting on it warms what the place reads first. */
function NavItem({ row, active, openPulls }: { row: NavRow; active: boolean; openPulls: number | null }) {
	const { id, label, href, icon: Icon } = row;
	const intent = useIntent(WARM[id]);

	return (
		<RowButton asChild data-nav data-active={active || undefined} className="nav-item">
			<Link href={href} aria-current={active ? 'page' : undefined} {...intent}>
				<Icon aria-hidden />
				{label}
				{id === 'pulls' && openPulls !== null ? (
					<span className="nav-count" aria-label={`${openPulls} open`}>
						{openPulls}
					</span>
				) : null}
			</Link>
		</RowButton>
	);
}
