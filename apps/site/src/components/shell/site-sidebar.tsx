'use client';

import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	ForgeMark,
	HoverList,
	Icon,
	NavPill,
	RowButton,
	Tooltip
} from '@recoder/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useTheme } from '@/lib/shell/theme';

import type { NavPage } from '~/lib/docs';
import { HANDOFF_MS, SECTION_UNFOLD, TRAVEL } from '~/lib/motion';
import { REPO_URL } from '~/lib/site';

import { SectionList } from './section-list';
import { SiteSearch } from './site-search';

const HOME: NavPage = { href: '/', title: 'Home', sections: [] };

/**
 * Scrolls the sideways row (narrow screens) just far enough to show the
 * current link. It moves only the row, never the page, and a column that
 * fits never scrolls.
 */
function revealCurrent(row: HTMLElement | null): void {
	const link = row?.querySelector<HTMLElement>('[aria-current="page"]');

	if (!row || !link) return;

	const box = row.getBoundingClientRect();
	const item = link.getBoundingClientRect();

	if (item.left < box.left) row.scrollLeft -= box.left - item.left;
	else if (item.right > box.right) row.scrollLeft += item.right - box.right;
}

/** A page's link: the app's sidebar row. The open page's fill travels here from the page before. */
function PageLink({ page, active }: { page: NavPage; active: boolean }) {
	return (
		<RowButton asChild data-active={active || undefined} className="nav-item">
			<Link href={page.href} aria-current={active ? 'page' : undefined}>
				{active ? <NavPill layoutId="site-nav-pill" transition={TRAVEL} /> : null}
				{page.title}
			</Link>
		</RowButton>
	);
}

interface DocsPageItemProps {
	page: NavPage;
	active: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** A docs page: its row, with a chevron at its end that unfolds the page's sections under it. */
function DocsPageItem({ page, active, open, onOpenChange }: DocsPageItemProps) {
	if (page.sections.length === 0) {
		return (
			<li className="nav-row">
				<PageLink page={page} active={active} />
			</li>
		);
	}

	return (
		<Collapsible asChild open={open} onOpenChange={onOpenChange}>
			<li>
				<div className="nav-row">
					<PageLink page={page} active={active} />
					<CollapsibleTrigger asChild>
						<Button variant="ghost" size="icon" className="site-page-toggle" aria-label={`Sections of ${page.title}`}>
							<Icon name="expand_more" className="site-page-chevron" />
						</Button>
					</CollapsibleTrigger>
				</div>
				<CollapsibleContent transition={SECTION_UNFOLD}>
					<SectionList page={page} open={active} />
				</CollapsibleContent>
			</li>
		</Collapsible>
	);
}

/**
 * Which pages show their sections: the open page's, plus any the reader
 * unfolded by hand. Going to another page unfolds it at once and folds the
 * others a moment later, once the open page's fill has travelled to its row,
 * so the fill never chases a row that is still moving. A deep link always
 * shows where it landed.
 */
function useUnfolded(current: string) {
	const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set([current]));
	const [shownFor, setShownFor] = useState(current);

	if (shownFor !== current) {
		setShownFor(current);
		setUnfolded((before) => new Set(before).add(current));
	}

	useEffect(() => {
		const timer = window.setTimeout(() => setUnfolded(new Set([current])), HANDOFF_MS);

		return () => window.clearTimeout(timer);
	}, [current]);

	/** Unfolds or folds one page's sections. */
	function toggle(href: string, open: boolean): void {
		setUnfolded((before) => {
			const next = new Set(before);

			if (open) next.add(href);
			else next.delete(href);

			return next;
		});
	}

	return { unfolded, toggle };
}

/** GitHub and the theme switch, at the foot. */
function SidebarFoot() {
	const toggleTheme = useTheme((state) => state.toggle);

	return (
		<div className="site-foot">
			<RowButton asChild className="nav-item site-github">
				<a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
					<ForgeMark provider="github" />
					<span className="site-github-label">GitHub</span>
					<Icon name="arrow_outward" className="site-github-arrow" />
				</a>
			</RowButton>
			<Tooltip content="Switch theme">
				<Button variant="ghost" size="icon" className="site-theme" aria-label="Switch theme" onClick={toggleTheme}>
					<Icon name="light_mode" className="hidden dark:block" />
					<Icon name="dark_mode" className="dark:hidden" />
				</Button>
			</Tooltip>
		</div>
	);
}

/**
 * The site's sidebar, on the chrome beside the page's card: the wordmark
 * and the search, Home and the docs pages (each folding its sections, the open
 * one unfolded), and GitHub and the theme at the foot. On narrow screens it
 * is a head row and a row of pages that scrolls sideways; the sections then
 * open from the page bar.
 */
export function SiteSidebar({ pages }: { pages: NavPage[] }) {
	const pathname = usePathname();
	const current = pathname.replace(/\/$/, '') || '/';
	const row = useRef<HTMLElement>(null);
	const { unfolded, toggle } = useUnfolded(current);

	useEffect(() => revealCurrent(row.current), [current]);

	return (
		<aside className="site-sidebar">
			<div className="site-head">
				<Link href="/" className="site-wordmark">
					Recoder
				</Link>
				<SiteSearch pages={[HOME, ...pages]} />
			</div>
			<nav ref={row} className="site-nav" aria-label="Site">
				<HoverList as="ul" itemSelector=".nav-row" className="site-nav-list">
					<li className="nav-row">
						<PageLink page={HOME} active={current === HOME.href} />
					</li>
					{pages.map((page) => (
						<DocsPageItem
							key={page.href}
							page={page}
							active={page.href === current}
							open={unfolded.has(page.href)}
							onOpenChange={(open) => toggle(page.href, open)}
						/>
					))}
				</HoverList>
			</nav>
			<SidebarFoot />
		</aside>
	);
}
