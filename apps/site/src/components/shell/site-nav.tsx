'use client';

import { Button, ForgeMark, HoverList, NavPill, NavPillGroup } from '@recoder/ui';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { docs } from '~/lib/docs';
import { REPO_URL } from '~/lib/site';

const LINKS = [{ href: '/', title: 'Home' }, ...docs.map((doc) => ({ href: `/docs/${doc.slug}`, title: doc.title }))];

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

/**
 * The site nav: Home, the docs pages and GitHub, in a slim column centered
 * down the card's left edge (a sideways row on narrow screens). The current
 * page's pill slides to a new pick; hover uses the list's snapping highlight.
 * The links sit in a fixed frame marked `layoutScroll`, so the pill measures
 * against the frame: a page scrolled before the click, which Next puts back
 * at the top, never throws the pill off.
 */
export function SiteNav() {
	const pathname = usePathname();
	const current = pathname.replace(/\/$/, '') || '/';
	const row = useRef<HTMLDivElement>(null);

	useEffect(() => revealCurrent(row.current), [current]);

	return (
		<nav className="site-nav" aria-label="Site">
			<motion.div ref={row} layoutScroll className="site-nav-scroll">
				<NavPillGroup>
					<HoverList as="ul" itemSelector="a" className="site-nav-list" highlightClassName="rounded-full">
						{LINKS.map((link) => {
							const active = link.href === current;

							return (
								<li key={link.href}>
									<Button asChild variant="ghost" className="site-nav-item">
										<Link href={link.href} aria-current={active ? 'page' : undefined}>
											{active ? <NavPill value={link.href} radius={999} className="bg-menu" /> : null}
											{link.title}
										</Link>
									</Button>
								</li>
							);
						})}
						<li>
							<Button asChild variant="ghost" className="site-nav-item">
								<a href={REPO_URL}>
									<span aria-hidden className="flex">
										<ForgeMark provider="github" />
									</span>
									GitHub
								</a>
							</Button>
						</li>
					</HoverList>
				</NavPillGroup>
			</motion.div>
		</nav>
	);
}
