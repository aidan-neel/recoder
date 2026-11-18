'use client';

import { ForgeMark, HoverList, NavPill, RowButton } from '@recoder/ui';
import { ArrowUpRightIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';

import type { NavPage } from '~/lib/docs';
import { REPO_URL } from '~/lib/site';
import { useCurrentSection } from '~/lib/use-current-section';

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

/** One page's row: the app's sidebar row, filled in place when it is the open page. */
function PageRow({ page, active }: { page: NavPage; active: boolean }) {
	return (
		<RowButton asChild data-active={active || undefined} className="nav-item">
			<Link href={page.href} aria-current={active ? 'page' : undefined}>
				{active ? <NavPill /> : null}
				{page.title}
			</Link>
		</RowButton>
	);
}

/**
 * Keeps the track's marker on the section the reader is in, hidden above the
 * first one. It lands in place on the first paint and slides from then on;
 * it moves again when the track reflows (a font arriving, a width change).
 */
function useTrackMarker(current: string | null) {
	const track = useRef<HTMLUListElement>(null);
	const marker = useRef<HTMLLIElement>(null);

	useLayoutEffect(() => {
		const list = track.current;
		const bar = marker.current;

		if (!list || !bar) return;

		/** Puts the marker over the current link, or fades it out when there is none. */
		function place(): void {
			if (!list || !bar) return;

			const link = list.querySelector<HTMLElement>('[aria-current]');

			bar.style.opacity = link ? '1' : '0';

			if (!link) return;

			bar.style.transform = `translateY(${link.offsetTop}px)`;
			bar.style.height = `${link.offsetHeight}px`;
		}

		place();

		const frame = requestAnimationFrame(() => bar.setAttribute('data-placed', ''));
		const observer = new ResizeObserver(place);

		observer.observe(list);

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [current]);

	return { track, marker };
}

/** The open page's sections on a track under its row. A marker slides to the one the reader is in as the page scrolls. */
function SectionList({ sections }: { sections: NavPage['sections'] }) {
	const current = useCurrentSection(sections.map((section) => section.id));
	const { track, marker } = useTrackMarker(current);

	return (
		<ul ref={track} className="site-sections">
			<li ref={marker} className="site-section-marker" role="presentation" aria-hidden />
			{sections.map((section) => (
				<li key={section.id}>
					<a
						href={`#${section.id}`}
						className="site-section"
						aria-current={section.id === current ? 'location' : undefined}
					>
						{section.title}
					</a>
				</li>
			))}
		</ul>
	);
}

/**
 * The site's sidebar, on the chrome beside the page's card: the wordmark,
 * the search, Home and the docs pages (the open one with its sections), and
 * GitHub at the foot. On narrow screens it is a head row and a row of pages
 * that scrolls sideways; the sections then open from the page bar.
 */
export function SiteSidebar({ pages }: { pages: NavPage[] }) {
	const pathname = usePathname();
	const current = pathname.replace(/\/$/, '') || '/';
	const row = useRef<HTMLElement>(null);

	useEffect(() => revealCurrent(row.current), [current]);

	return (
		<aside className="site-sidebar">
			<Link href="/" className="site-wordmark">
				Recoder
			</Link>
			<SiteSearch pages={[HOME, ...pages]} />
			<nav ref={row} className="site-nav" aria-label="Site">
				<HoverList as="ul" itemSelector=".nav-item" className="site-nav-list">
					<li>
						<PageRow page={HOME} active={current === HOME.href} />
					</li>
					<li role="presentation" className="site-nav-label section-label">
						Docs
					</li>
					{pages.map((page) => (
						<li key={page.href}>
							<PageRow page={page} active={page.href === current} />
							{page.href === current && page.sections.length > 0 ? <SectionList sections={page.sections} /> : null}
						</li>
					))}
				</HoverList>
			</nav>
			<RowButton asChild className="nav-item site-github">
				<a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
					<ForgeMark provider="github" />
					<span className="site-github-label">GitHub</span>
					<ArrowUpRightIcon aria-hidden className="site-github-arrow" />
				</a>
			</RowButton>
		</aside>
	);
}
