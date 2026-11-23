'use client';

import { HoverList, Icon, RowButton, type IconName } from '@recoder/ui';
import { usePathname } from '@/lib/shell/navigation';

import { useApi } from '@/lib/api/client';
import { useIntent } from '@/lib/shell/intent';
import { AUTOMATIONS_HREF, GUIDELINES_HREF, isLiveApp, newReviewHref, pullsHref, reposHref } from '@/lib/shell/routes';

import { Link } from '@/components/common/link';

type Place = 'new' | 'pulls' | 'repos' | 'automations' | 'guidelines';

interface NavRow {
	id: Place;
	label: string;
	href: string;
	icon: IconName;
}

/**
 * What a place reads first, started once the pointer rests on its row so the
 * page opens filled rather than on its skeleton. The stores load on demand,
 * from code the app already has.
 */
const WARM: Partial<Record<Place, () => void>> = {
	automations: () => void import('@/lib/settings/use-auto-review-section').then((module) => module.loadAutomations()),
	guidelines: () =>
		void import('@/lib/guidelines/guidelines-store').then((module) => module.useGuidelines.getState().load())
};

/** The places only the live app has. */
const LIVE_ROWS: NavRow[] = [
	{ id: 'automations', label: 'Automations', href: AUTOMATIONS_HREF, icon: 'schedule' },
	{ id: 'guidelines', label: 'Guidelines', href: GUIDELINES_HREF, icon: 'menu_book' }
];

/** The place the address belongs to, or null on a page the sidebar does not list, such as a chat. */
function placeOf(pathname: string, base: string): Place | null {
	const path = pathname.slice(base.length) || '/';

	if (path.startsWith('/new')) return 'new';
	if (path === '/' || path.startsWith('/pulls')) return 'pulls';
	if (path === '/repos') return 'repos';
	if (pathname.startsWith(AUTOMATIONS_HREF)) return 'automations';
	if (pathname.startsWith(GUIDELINES_HREF)) return 'guidelines';

	return null;
}

/**
 * New review, then the places. The place on screen sits on a still fill; the count beside Pull requests is the open
 * ones. The sample lists only the places it has.
 */
export function SidebarNav({ openPulls }: { openPulls: number | null }) {
	const { base } = useApi();
	const active = placeOf(usePathname(), base);

	const rows: NavRow[] = [
		{ id: 'new', label: 'New review', href: newReviewHref(base), icon: 'add' },
		{ id: 'pulls', label: 'Pull requests', href: pullsHref(base), icon: 'pull_request' },
		{ id: 'repos', label: 'Repositories', href: reposHref(base), icon: 'folder' },
		...(isLiveApp(base) ? LIVE_ROWS : [])
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
	const { id, label, href, icon } = row;
	const intent = useIntent(WARM[id]);

	return (
		<RowButton asChild data-nav data-active={active || undefined} className="nav-item">
			<Link href={href} aria-current={active ? 'page' : undefined} {...intent}>
				<Icon name={icon} />
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
