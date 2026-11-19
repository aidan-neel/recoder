'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';

import type { NavPage } from '~/lib/docs';
import { ROW } from '~/lib/motion';
import { useCurrentSection } from '~/lib/use-current-section';

/**
 * Keeps the track's marker on the section the reader is in, hidden above the
 * first one. It lands in place on the first paint and travels from then on;
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

interface SectionListProps {
	page: NavPage;
	/** Whether the page is the one open: its links then stay on the page, and the marker follows the reader. */
	open: boolean;
}

/**
 * A page's sections on a track under its row. On the open page a marker
 * travels to the one the reader is in as the page scrolls; another page's
 * sections lead to that page. The rows follow the list as it unfolds, one
 * after another.
 */
export function SectionList({ page, open }: SectionListProps) {
	const current = useCurrentSection(open ? page.sections.map((section) => section.id) : []);
	const { track, marker } = useTrackMarker(current);

	return (
		<ul ref={track} className="site-sections">
			<li ref={marker} className="site-section-marker" role="presentation" aria-hidden />
			{page.sections.map((section) => (
				<motion.li key={section.id} variants={ROW}>
					{open ? (
						<a
							href={`#${section.id}`}
							className="site-section"
							aria-current={section.id === current ? 'location' : undefined}
						>
							{section.title}
						</a>
					) : (
						<Link href={`${page.href}#${section.id}`} className="site-section">
							{section.title}
						</Link>
					)}
				</motion.li>
			))}
		</ul>
	);
}
